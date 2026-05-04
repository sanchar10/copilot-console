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
_HELP_SESSION_NAME = "Copilot Console Help"
_HELP_TRIGGER = "help"
_HELP_TIMEOUT_SECONDS = 120

_lock = asyncio.Lock()


def _build_system_prompt() -> str:
    """Build the help system prompt with the runtime docs path baked in."""
    docs_path = APP_HOME / "docs"
    return (
        "You are the Copilot Console Help assistant. You answer questions about "
        "the Copilot Console app — features, setup, troubleshooting, slash commands, "
        "workflows, automations, MCP servers, agents, and configuration — by reading "
        "the bundled documentation.\n\n"
        "## How to answer\n\n"
        f"1. The docs live at: `{docs_path}`\n"
        "   - **Read `guides/FAQ.md` FIRST.** It captures cross-cutting questions "
        "(\"how do I X?\", \"why does Y look broken?\") that span multiple features. "
        "Most questions are answered there directly with a short, accurate paragraph "
        "and a pointer to the deeper guide.\n"
        "   - Top-level: `README.md` (overview, install, quickstart, feature tour)\n"
        "   - `guides/` — per-feature guides:\n"
        "     - FAQ.md (start here)\n"
        "     - INSTALL.md, TROUBLESHOOTING.md, KNOWN-LIMITATIONS.md\n"
        "     - WORKFLOWS.md, AUTOMATIONS.md, SESSIONS.md\n"
        "     - AGENT-LIBRARY.md, AGENT-TEAMS.md, CUSTOM-TOOLS.md\n"
        "     - MCP-SERVERS.md, MOBILE-COMPANION.md, SAMPLES.md\n"
        "     - CONTRIBUTING.md, AF_SDK_PATCHES.md\n\n"
        "2. Use the `view` tool. Read `guides/FAQ.md` first; if the question is "
        "covered there, answer from it (and follow any `→ See:` link if the user "
        "asks for more depth). Only crawl other guides when FAQ has no match.\n\n"
        "3. Answer the user's question based on what the docs say. Be helpful, "
        "concise, and accurate. Prefer short answers with a link to the relevant doc.\n\n"
        "4. Cite which doc the answer came from, e.g. \"(from guides/FAQ.md)\" "
        "or \"(from guides/MCP-SERVERS.md)\".\n\n"
        "## Guidelines\n\n"
        "- Always read the docs before answering — don't guess or fabricate.\n"
        "- If neither FAQ nor the per-feature guides cover the topic, say so clearly "
        "and suggest where to look (e.g. GitHub issues, the slash-command palette, "
        "or the Settings panel).\n"
        "- Keep answers focused. The user is in the middle of another task and just "
        "needs a quick, accurate answer.\n"
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
    """Return (session_id, is_new_session, model)."""
    settings = storage_service.get_settings()
    model = settings.get("default_model") or "gpt-4.1"

    persisted = _read_persisted_id()
    if persisted and storage_service.load_session(persisted):
        return persisted, False, model

    # No persisted ID, or persisted ID points to a deleted session — create fresh.
    session = await session_service.create_session(SessionCreate(
        model=model,
        name=_HELP_SESSION_NAME,
        cwd=DEFAULT_CWD,
        mcp_servers=[],
        tools=AgentTools(builtin=["view"]),
        system_message={"mode": "replace", "content": _build_system_prompt()},
        trigger=_HELP_TRIGGER,
    ))
    _write_persisted_id(session.session_id)
    logger.info(f"Created /help session {session.session_id}")
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
