"""In-app help (`/help`) — single hardcoded session that answers user questions
about Copilot Console by reading the bundled docs.

Design:
- One persistent hidden session (trigger="help") shared across all /help calls.
- Session ID persisted in settings.json (`help_session_id`) so it survives restarts.
- Reuses session_service.create_session + copilot_service.send_message_background,
  inheriting the 15-min idle-kill, SDK lifecycle, persistence, and compaction.
- All calls are serialized through a module-level lock — /help is infrequent
  and we want to avoid concurrent send_message on the same SDK session.
"""

from __future__ import annotations

import asyncio

from copilot_console.app.config import APP_HOME, DEFAULT_CWD
from copilot_console.app.models.agent import AgentTools
from copilot_console.app.models.session import SessionCreate
from copilot_console.app.services.copilot_service import copilot_service
from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.services.response_buffer import response_buffer_manager
from copilot_console.app.services.session_service import session_service
from copilot_console.app.services.storage_service import storage_service

logger = get_logger(__name__)

_HELP_SETTINGS_KEY = "help_session_id"
_HELP_VERSION_KEY = "help_session_app_version"
_HELP_SESSION_NAME = "Copilot Console Help"
_HELP_TRIGGER = "help"
_HELP_TIMEOUT_SECONDS = 120

_lock = asyncio.Lock()


def _get_app_version() -> str:
    try:
        from copilot_console import __version__
        return str(__version__)
    except Exception as e:
        logger.warning(f"Could not read app version for /help session pinning: {e}")
        return "unknown"


def _build_system_prompt() -> str:
    """Build the help system prompt with the runtime docs path baked in."""
    docs_path = APP_HOME / "docs"
    return (
        "You are the Copilot Console Help assistant. You answer questions about "
        "the Copilot Console app — features, setup, troubleshooting, slash commands, "
        "workflows, automations, MCP servers, agents, and configuration — by reading "
        "the bundled documentation.\n\n"
        "## Hard rules (do not skip)\n\n"
        "1. **You MUST call the `view` tool to read `guides/FAQ.md` BEFORE writing any "
        "answer.** Do not answer from memory or training data. If you have not just "
        "viewed a doc this turn, you have no grounds to answer — say so and stop.\n"
        "2. **Scan FAQ.md for the user's key terms.** Identify the 2–4 most specific "
        "terms in the question (e.g. `/agent`, `MCP`, `sub-agent`, `workflow`, "
        "`Sub-Agents picker`). Search the FAQ headings and body for each. Only after "
        "you've confirmed FAQ has no relevant section may you `view` other guides.\n"
        "3. **Quote your source.** Every answer must include at least one short "
        "(1–3 line) verbatim quote from the doc, in a markdown blockquote. If you "
        "can't find a verbatim line that supports your answer, you don't have an "
        "answer — say \"I don't see this covered in the bundled docs\" and point "
        "to the most likely guide instead. Never reason from general AI/CLI "
        "knowledge to fill the gap.\n"
        "4. **Cite the file path** at the end, e.g. \"(from guides/FAQ.md)\". "
        "If you cite a doc, you must have actually called `view` on it this turn.\n\n"
        "## Where the docs live\n\n"
        f"- Docs root: `{docs_path}`\n"
        "- **Always read first:** `guides/FAQ.md` (cross-cutting Q&A, hand-validated)\n"
        "- Top-level: `README.md` (overview, install, quickstart, feature tour)\n"
        "- `guides/` — per-feature deep-dives:\n"
        "  - INSTALL.md, TROUBLESHOOTING.md, KNOWN-LIMITATIONS.md\n"
        "  - WORKFLOWS.md, AUTOMATIONS.md, SESSIONS.md\n"
        "  - AGENT-LIBRARY.md, AGENT-TEAMS.md, CUSTOM-TOOLS.md\n"
        "  - MCP-SERVERS.md, MOBILE-COMPANION.md, SAMPLES.md\n"
        "  - CONTRIBUTING.md, AF_SDK_PATCHES.md\n\n"
        "## Style\n\n"
        "- Keep answers focused and short. The user is in the middle of another "
        "task and just needs a quick, accurate, doc-grounded answer.\n"
        "- Prefer a short paragraph + the supporting quote + a `→ See:` link to "
        "the deeper guide.\n"
        "- If neither FAQ nor the per-feature guides cover the topic, say so "
        "explicitly: \"I don't see this covered in the bundled docs — try the "
        "GitHub issues at https://github.com/sanchar10/copilot-console/issues, "
        "or check the Settings panel and slash-command palette.\" Do not "
        "invent steps, paths, or UI elements.\n"
    )


def _read_persisted_id() -> str | None:
    try:
        sid = storage_service.get_settings().get(_HELP_SETTINGS_KEY)
        return sid if isinstance(sid, str) and sid else None
    except Exception as e:
        logger.warning(f"Failed to read help session id from settings: {e}")
        return None


def _write_persisted_id(session_id: str) -> None:
    try:
        storage_service.update_settings({_HELP_SETTINGS_KEY: session_id})
    except Exception as e:
        logger.warning(f"Failed to persist help session id to settings: {e}")


async def _get_or_create_help_session() -> tuple[str, bool, str]:
    """Return (session_id, is_new_session, model).

    The persisted help session is pinned to the app version it was created
    against. When the app upgrades (which also triggers a docs re-seed and
    may include a new system prompt), we discard the old session and create
    a fresh one — otherwise the SDK conversation carries forward stale
    context (e.g. answers grounded on docs that no longer match) and the
    agent confidently parrots its prior turns instead of re-reading docs.
    """
    settings = storage_service.get_settings()
    model = settings.get("default_model") or "gpt-4.1"
    current_version = _get_app_version()

    persisted_id = _read_persisted_id()
    persisted_version = settings.get(_HELP_VERSION_KEY)

    if (
        persisted_id
        and persisted_version == current_version
        and storage_service.load_session(persisted_id)
    ):
        return persisted_id, False, model

    if persisted_id:
        logger.info(
            f"Discarding /help session {persisted_id} "
            f"(was v{persisted_version}, app is v{current_version}) — recreating"
        )

    session = await session_service.create_session(SessionCreate(
        model=model,
        name=_HELP_SESSION_NAME,
        cwd=DEFAULT_CWD,
        mcp_servers=[],
        tools=AgentTools(builtin=["view"]),
        system_message={"mode": "replace", "content": _build_system_prompt()},
        trigger=_HELP_TRIGGER,
    ))
    try:
        storage_service.update_settings({
            _HELP_SETTINGS_KEY: session.session_id,
            _HELP_VERSION_KEY: current_version,
        })
    except Exception as e:
        logger.warning(f"Failed to persist help session metadata: {e}")
    logger.info(f"Created /help session {session.session_id} for v{current_version}")
    return session.session_id, True, model


async def ask_help(question: str) -> dict:
    """Run a /help question through the persistent help session.

    Returns: {"answer": str, "session_id": str}
    Raises: ValueError on empty input; RuntimeError on backend failure.
    """
    q = (question or "").strip()
    if not q:
        raise ValueError("Question cannot be empty")

    async with _lock:
        session_id, is_new_session, model = await _get_or_create_help_session()

        # System message and tools are bound on session creation; subsequent
        # turns just need the prompt + a buffer.
        system_message: dict | None = None
        tools_builtin: list[str] | None = None
        if is_new_session:
            system_message = {"mode": "replace", "content": _build_system_prompt()}
            tools_builtin = ["view"]

        buffer = await response_buffer_manager.create_buffer(session_id)
        try:
            await asyncio.wait_for(
                copilot_service.send_message_background(
                    session_id=session_id,
                    model=model,
                    cwd=DEFAULT_CWD,
                    prompt=q,
                    buffer=buffer,
                    available_tools=tools_builtin,
                    system_message=system_message,
                    is_new_session=is_new_session,
                ),
                timeout=_HELP_TIMEOUT_SECONDS,
            )
            buffer.complete()
            answer = buffer.get_full_content().strip()
            if not answer:
                answer = "(no answer returned)"
            return {"answer": answer, "session_id": session_id}
        except asyncio.TimeoutError:
            logger.warning(f"/help session {session_id} timed out after {_HELP_TIMEOUT_SECONDS}s")
            partial = buffer.get_full_content().strip() if buffer else ""
            raise RuntimeError(
                f"Help request timed out after {_HELP_TIMEOUT_SECONDS}s"
                + (f". Partial answer: {partial[:500]}" if partial else "")
            )
        except Exception as e:
            logger.error(f"/help failed: {e}", exc_info=True)
            raise RuntimeError(f"Help request failed: {e}") from e
        finally:
            await response_buffer_manager.remove_buffer(session_id)
