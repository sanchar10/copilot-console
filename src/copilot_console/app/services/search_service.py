"""Search service for full-text search across session names and message content.

Uses ripgrep (rg) for fast content search across events.jsonl files,
combined with in-memory session name matching.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from copilot_console.app.config import COPILOT_SESSION_STATE
from copilot_console.app.models.search import SearchResult, SearchSnippet
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

# Maximum snippets per session to avoid overwhelming results
MAX_SNIPPETS_PER_SESSION = 5
# Context chars around the match for snippet preview
SNIPPET_CONTEXT_CHARS = 80
# Minimum query length for content search
MIN_QUERY_LENGTH = 2

_rg_path: str | None = None
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rg")


def _find_ripgrep() -> str | None:
    """Find ripgrep binary on PATH."""
    global _rg_path
    if _rg_path is not None:
        return _rg_path
    _rg_path = shutil.which("rg") or ""
    if _rg_path:
        logger.info(f"ripgrep found: {_rg_path}")
    else:
        logger.warning("ripgrep (rg) not found on PATH — content search disabled")
    return _rg_path or None


def _extract_snippet(content: str, query: str) -> str:
    """Extract a snippet around the first match of query in content."""
    lower = content.lower()
    q = query.lower()
    idx = lower.find(q)
    if idx == -1:
        return content[:SNIPPET_CONTEXT_CHARS * 2]

    start = max(0, idx - SNIPPET_CONTEXT_CHARS)
    end = min(len(content), idx + len(query) + SNIPPET_CONTEXT_CHARS)
    snippet = content[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(content):
        snippet = snippet + "..."
    return snippet


async def search(query: str, sessions: list) -> list[SearchResult]:
    """Search across session names and message content.

    Args:
        query: Search term.
        sessions: List of Session objects (from session_service.list_sessions).

    Returns:
        List of SearchResult sorted by last_active descending.
    """
    if not query or len(query) < MIN_QUERY_LENGTH:
        return []

    # Build session lookup: id -> (name, last_active timestamp, trigger)
    session_map: dict[str, tuple[str, float, str | None]] = {}
    for s in sessions:
        ts = s.updated_at.timestamp() if s.updated_at else 0.0
        session_map[s.session_id] = (s.session_name, ts, getattr(s, "trigger", None))

    results: dict[str, SearchResult] = {}
    q_lower = query.lower()

    # 1. Name search — instant, in-memory
    for s in sessions:
        name = s.session_name or ""
        if q_lower in name.lower():
            _, ts, trig = session_map[s.session_id]
            results[s.session_id] = SearchResult(
                session_id=s.session_id,
                session_name=name,
                match_type="name",
                snippets=[],
                last_active=ts,
                trigger=trig,
            )

    # 2. Content search — ripgrep across events.jsonl
    rg = _find_ripgrep()
    if rg and COPILOT_SESSION_STATE.exists():
        content_results = await _ripgrep_search(rg, query, session_map)
        for sid, snippets in content_results.items():
            if sid in results:
                results[sid].snippets = snippets
                results[sid].match_type = "both"
            else:
                name, ts, trig = session_map.get(sid, (sid, 0.0, None))
                results[sid] = SearchResult(
                    session_id=sid,
                    session_name=name,
                    match_type="content",
                    snippets=snippets,
                    last_active=ts,
                    trigger=trig,
                )

    # Sort by last_active descending
    sorted_results = sorted(results.values(), key=lambda r: r.last_active, reverse=True)
    return sorted_results


async def _ripgrep_search(
    rg_path: str, query: str, session_map: dict[str, tuple[str, float, str | None]]
) -> dict[str, list[SearchSnippet]]:
    """Run ripgrep and parse results into snippets grouped by session."""
    search_dir = str(COPILOT_SESSION_STATE)

    # rg --json: structured output with match details
    # -i: case-insensitive
    # -g events.jsonl: only search events.jsonl files
    # --max-count 20: limit matches per file
    cmd = [
        rg_path, "--json", "-i",
        "--max-count", "20",
        "-g", "events.jsonl",
        "--", query, search_dir,
    ]

    try:
        # Use subprocess.run in thread pool — asyncio subprocess unreliable on Windows
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            _executor,
            lambda: subprocess.run(
                cmd,
                capture_output=True,
                timeout=10,
            ),
        )
        stdout = result.stdout
        if result.returncode not in (0, 1):
            # rg returns 1 for "no matches", 2+ for errors
            logger.warning(f"ripgrep exited with code {result.returncode}: {result.stderr.decode()[:200]}")
            return {}
    except subprocess.TimeoutExpired:
        logger.warning("ripgrep search timed out")
        return {}
    except Exception as e:
        logger.warning(f"ripgrep search failed: {type(e).__name__}: {e}")
        return {}

    results: dict[str, list[SearchSnippet]] = {}

    for line in stdout.decode("utf-8", errors="replace").splitlines():
        if not line:
            continue
        try:
            rg_event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if rg_event.get("type") != "match":
            continue

        data = rg_event.get("data", {})
        path_text = data.get("path", {}).get("text", "")
        matched_line = data.get("lines", {}).get("text", "")

        # Extract session_id from path: .../session-state/{session-id}/events.jsonl
        session_id = _extract_session_id(path_text)
        if not session_id:
            continue

        # Parse the matched events.jsonl line
        snippet = _parse_event_line(matched_line, query)
        if not snippet:
            continue

        if session_id not in results:
            results[session_id] = []
        if len(results[session_id]) < MAX_SNIPPETS_PER_SESSION:
            results[session_id].append(snippet)

    return results


def _extract_session_id(path: str) -> str | None:
    """Extract session UUID from file path."""
    # Match UUID pattern in path
    match = re.search(
        r"[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]",
        path, re.IGNORECASE,
    )
    return match.group(1) if match else None


def _parse_event_line(line: str, query: str) -> SearchSnippet | None:
    """Parse an events.jsonl line and extract a search snippet if relevant."""
    line = line.strip()
    if not line:
        return None

    # Quick pre-filter: only parse user.message and assistant.message events
    if '"user.message"' not in line and '"assistant.message"' not in line:
        return None

    try:
        evt = json.loads(line)
    except json.JSONDecodeError:
        return None

    evt_type = evt.get("type", "")
    if evt_type not in ("user.message", "assistant.message"):
        return None

    evt_data = evt.get("data", {})
    content = evt_data.get("content", "")
    if not content or query.lower() not in content.lower():
        return None

    role = "user" if evt_type == "user.message" else "assistant"
    sdk_message_id = evt_data.get("messageId") or evt.get("id")
    timestamp = evt.get("timestamp")

    snippet_text = _extract_snippet(content, query)

    return SearchSnippet(
        content=snippet_text,
        message_role=role,
        sdk_message_id=sdk_message_id,
        timestamp=timestamp,
    )
