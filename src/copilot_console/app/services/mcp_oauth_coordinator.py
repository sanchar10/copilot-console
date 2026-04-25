"""MCP OAuth coordinator (per-session).

Owns the OAuth sign-in lifecycle for HTTP MCP servers within one SDK session.

Design (lazy-only, react-don't-poll):
- The agent invokes a tool against an HTTP MCP server that needs auth → that call
  fails. Eventually we observe the failure (in EventProcessor) and call
  ``trigger(server_name)``.
- ``trigger()`` is sync; it schedules an asyncio task that:
    1. Calls ``session.rpc.mcp.oauth.login(MCPOauthLoginRequest(...))``.
    2. If a non-None ``authorization_url`` is returned, emits
       ``mcp_oauth_required`` so the UI can open the browser, then bounded-polls
       ``session.rpc.mcp.list()`` until the server's status flips to
       ``connected`` (or ``failed``/timeout).
    3. Emits ``mcp_oauth_completed`` on success or ``mcp_oauth_failed`` on
       failure / timeout.
- Calls are deduplicated per ``server_name``: a second ``trigger()`` while the
  first is still in flight is a no-op.

Notification delivery is delegated to a sync callback supplied at construction
time so the wiring layer (``copilot_service``) can route to the active turn's
event queue and/or the session's durable response buffer.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)

# Bounded poll: every POLL_INTERVAL seconds, max POLL_MAX_ATTEMPTS attempts
# (default 90s — covers ~95% of real MFA flows including push + retries and
# simple conditional-access prompts, while letting dismissed-toast scenarios
# recover quickly: a fresh trigger on the next user message can re-mint a
# new auth URL once the in-flight task expires).
POLL_INTERVAL_SECONDS = 2.5
POLL_MAX_ATTEMPTS = 36

# Terminal status values from MCPServerStatus enum (rpc.py:675-683)
TERMINAL_OK = {"connected"}
TERMINAL_BAD = {"failed", "disabled", "not_configured"}
NEEDS_AUTH = "needs-auth"

NotifyCallback = Callable[[str, dict[str, Any]], None]


class MCPOAuthCoordinator:
    """Per-session OAuth flow coordinator. Owned by SessionClient."""

    def __init__(
        self,
        session_id: str,
        get_session: Callable[[], Any],
        notify: NotifyCallback,
        client_name: str = "Copilot Console",
    ) -> None:
        self.session_id = session_id
        # We use a getter (rather than capturing the session directly) because
        # SessionClient.session may be replaced when a session is resumed.
        self._get_session = get_session
        self._notify = notify
        self._client_name = client_name
        self._inflight: dict[str, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()
        self._closed = False
        # Last-seen status per server. Used to publish ``mcp_server_status``
        # on every transition so the frontend badge stays live without
        # polling. None means "never observed".
        self._last_status: dict[str, str | None] = {}

    def _publish_status(
        self,
        server_name: str,
        status: str | None,
        error: str | None = None,
        force: bool = False,
    ) -> None:
        """Publish ``mcp_server_status`` if status changed since last publish.

        ``force=True`` re-publishes regardless (used after retrigger so the
        UI sees a fresh snapshot even if the underlying state didn't change).
        """
        if not force and self._last_status.get(server_name) == status:
            return
        self._last_status[server_name] = status
        self._notify("mcp_server_status", {
            "sessionId": self.session_id,
            "statuses": [
                {"serverName": server_name, "status": status, "error": error},
            ],
        })

    def trigger(self, server_name: str) -> None:
        """Start an OAuth flow for ``server_name`` if one is not already in flight.

        Sync entrypoint — safe to call from synchronous SDK event handlers.
        """
        if self._closed:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                f"[{self.session_id}] OAuth trigger for '{server_name}' invoked off-loop — dropping"
            )
            return
        loop.create_task(self._maybe_start(server_name))

    async def trigger_async(self, server_name: str) -> None:
        """Async variant of :meth:`trigger` — useful from already-async paths."""
        if self._closed:
            return
        await self._maybe_start(server_name)

    async def check_and_trigger_for_needs_auth(self) -> None:
        """List MCP servers and trigger OAuth for any in ``needs-auth``.

        Used as the discovery fallback after each turn end / on session error
        when we don't have a reliable in-event server-name signal.
        """
        if self._closed:
            return
        session = self._get_session()
        if session is None:
            return
        try:
            servers = _extract_servers(await session.rpc.mcp.list())
        except Exception as e:
            logger.debug(f"[{self.session_id}] mcp.list() failed during OAuth check: {e}")
            return
        statuses = [
            (getattr(s, "name", "?"), _status_value(getattr(s, "status", None)))
            for s in servers
        ]
        logger.info(f"[{self.session_id}] OAuth check: mcp.list -> {statuses}")
        for srv in servers:
            status = _status_value(getattr(srv, "status", None))
            if status == NEEDS_AUTH:
                name = getattr(srv, "name", None)
                if name:
                    logger.info(f"[{self.session_id}] Triggering OAuth for '{name}' (status=needs-auth)")
                    await self._maybe_start(name)

    async def wait_until_ready(
        self,
        timeout: float = 30.0,
        poll_interval: float = 0.5,
    ) -> dict[str, str | None]:
        """Block until every MCP server has reached a terminal status, or ``timeout`` elapses.

        Behaviour per server:
        - ``connected`` / ``disabled`` / ``failed`` → terminal, recorded as final status.
        - ``needs-auth`` → schedule the OAuth flow (idempotent) and keep polling.
          ``_run_flow`` already publishes ``mcp_oauth_required`` to the bus so the UI
          can prompt the user; once the user signs in (or the flow fails) the server's
          status flips and we record it.
        - ``pending`` / ``not_configured`` / ``None`` → still booting; keep polling.

        Returns ``{server_name: final_status}``. Servers that never reach a terminal
        state within the deadline are returned with their last observed status (which
        may be ``None`` if ``mcp.list()`` never succeeded).

        The wait is silent on the per-turn stream — OAuth feedback flows on the global
        event bus so the caller can keep its activation UX intact during the wait.
        """
        if self._closed:
            return {}

        # NOTE: do NOT include ``not_configured`` here — the SDK reports that
        # status transiently while it's probing HTTP MCP servers, before it
        # flips to ``connected`` (or ``needs-auth``). Treating it as terminal
        # would cause the gate to exit immediately on the first poll and
        # defeat the whole purpose of this method. The ``timeout`` is the
        # safety net for servers that genuinely never come up.
        terminal_states = TERMINAL_OK | {"failed", "disabled"}
        final_status: dict[str, str | None] = {}
        last_seen: dict[str, str | None] = {}

        loop = asyncio.get_running_loop()
        deadline = loop.time() + max(0.0, timeout)

        while True:
            if self._closed:
                break

            servers = await self.snapshot()
            if servers:
                for entry in servers:
                    name = entry.get("serverName")
                    if not name:
                        continue
                    status = entry.get("status")
                    last_seen[name] = status
                    if name in final_status:
                        continue
                    if status in terminal_states:
                        final_status[name] = status
                    elif status == NEEDS_AUTH:
                        # _maybe_start dedups, so it's safe to call on every poll.
                        await self._maybe_start(name)

                # All known servers are terminal? Done.
                pending = [
                    name
                    for name in last_seen
                    if name not in final_status
                ]
                if not pending:
                    break
            # If snapshot returned [], either the session is gone or mcp.list
            # failed transiently — let the deadline catch this.

            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            await asyncio.sleep(min(poll_interval, remaining))

        # Anything we never resolved gets its last-observed status (could be None).
        for name, status in last_seen.items():
            final_status.setdefault(name, status)

        if final_status:
            logger.info(
                f"[{self.session_id}] wait_until_ready -> {final_status}"
            )
        return final_status

    async def snapshot(self) -> list[dict[str, Any]]:
        """Return current per-server status as a serializable list (no triggers).

        Also opportunistically publishes status transitions discovered during
        the snapshot — keeps the badge live even when the only call path is
        the per-turn ``wait_until_ready``.
        """
        session = self._get_session()
        if session is None:
            return []
        try:
            servers = _extract_servers(await session.rpc.mcp.list())
        except Exception as e:
            logger.debug(f"[{self.session_id}] mcp.list() failed in snapshot: {e}")
            return []
        result = [
            {
                "serverName": getattr(s, "name", None),
                "status": _status_value(getattr(s, "status", None)),
                "error": getattr(s, "error", None),
            }
            for s in servers
        ]
        # Publish any transitions seen vs last_status. This is how the
        # frontend badge keeps up with status flips that happen between
        # explicit OAuth flow points (e.g., the SDK's silent boot from
        # ``not_configured`` → ``connected``).
        for entry in result:
            name = entry.get("serverName")
            if not name:
                continue
            self._publish_status(name, entry.get("status"), entry.get("error"))
        return result

    async def retrigger(self, server_name: str) -> None:
        """Cancel any in-flight OAuth task for ``server_name`` and start fresh.

        Used by the "Sign in" affordance on a stale badge: the original
        ``_run_flow`` may still be in its 90s poll budget (so a plain
        ``_maybe_start`` would dedup), but the user wants a NEW auth URL
        right now (the original tab was closed, the URL expired, etc).
        We force-cancel and restart so the SDK mints a fresh URL.
        """
        if self._closed:
            return
        async with self._lock:
            existing = self._inflight.pop(server_name, None)
        if existing is not None and not existing.done():
            existing.cancel()
            try:
                await existing
            except (asyncio.CancelledError, Exception):
                pass
        await self._maybe_start(server_name)

    async def cancel_all(self) -> None:
        """Cancel all in-flight tasks. Called from SessionClient.stop()."""
        self._closed = True
        async with self._lock:
            tasks = list(self._inflight.values())
            self._inflight.clear()
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def _maybe_start(self, server_name: str) -> None:
        async with self._lock:
            if self._closed:
                return
            existing = self._inflight.get(server_name)
            if existing and not existing.done():
                return
            task = asyncio.create_task(self._run_flow(server_name))
            self._inflight[server_name] = task

        def _cleanup(_: asyncio.Task[None]) -> None:
            self._inflight.pop(server_name, None)

        task.add_done_callback(_cleanup)

    async def _run_flow(self, server_name: str) -> None:
        session = self._get_session()
        if session is None:
            logger.debug(f"[{self.session_id}] OAuth flow for '{server_name}' aborted — no session")
            return

        # Lazy-import the SDK request type so unit tests of unrelated code
        # don't pay an import cost.
        try:
            from copilot.generated.rpc import MCPOauthLoginRequest
        except Exception as e:  # pragma: no cover — SDK should always provide it
            logger.error(f"[{self.session_id}] MCPOauthLoginRequest import failed: {e}")
            self._notify("mcp_oauth_failed", {
                "sessionId": self.session_id,
                "serverName": server_name,
                "reason": f"SDK import error: {e}",
            })
            return

        try:
            req = MCPOauthLoginRequest(
                server_name=server_name,
                client_name=self._client_name,
            )
            logger.info(f"[{self.session_id}] Calling mcp.oauth.login for '{server_name}'")
            result = await session.rpc.mcp.oauth.login(req)
        except Exception as e:
            logger.warning(f"[{self.session_id}] oauth.login failed for '{server_name}': {e}")
            self._notify("mcp_oauth_failed", {
                "sessionId": self.session_id,
                "serverName": server_name,
                "reason": str(e),
            })
            return

        auth_url = getattr(result, "authorization_url", None)
        if auth_url is None:
            logger.info(f"[{self.session_id}] OAuth for '{server_name}' returned no auth URL — token was cached")
            await self._reconcile_after_login(server_name, completed=True)
            return

        logger.info(f"[{self.session_id}] OAuth required for '{server_name}': {auth_url}")
        self._notify("mcp_oauth_required", {
            "sessionId": self.session_id,
            "serverName": server_name,
            "authorizationUrl": auth_url,
        })

        # Bounded poll until the server flips out of needs-auth.
        for _ in range(POLL_MAX_ATTEMPTS):
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            if self._closed:
                return
            session = self._get_session()
            if session is None:
                return
            try:
                servers = _extract_servers(await session.rpc.mcp.list())
            except Exception as e:
                logger.debug(f"[{self.session_id}] mcp.list() poll failed for '{server_name}': {e}")
                continue
            srv = next((s for s in servers if getattr(s, "name", None) == server_name), None)
            if srv is None:
                continue
            status = _status_value(getattr(srv, "status", None))
            err = getattr(srv, "error", None)
            # Publish badge updates on every poll cycle (deduped by _publish_status).
            self._publish_status(server_name, status, err)
            if status in TERMINAL_OK:
                self._notify("mcp_oauth_completed", {
                    "sessionId": self.session_id,
                    "serverName": server_name,
                    "status": status,
                })
                return
            if status in TERMINAL_BAD:
                self._notify("mcp_oauth_failed", {
                    "sessionId": self.session_id,
                    "serverName": server_name,
                    "reason": f"Server reached terminal status: {status}",
                    "error": err,
                })
                return
            # else: still pending or needs-auth — keep polling

        self._notify("mcp_oauth_failed", {
            "sessionId": self.session_id,
            "serverName": server_name,
            "reason": "Sign-in did not complete within the timeout window.",
        })

    async def _reconcile_after_login(self, server_name: str, completed: bool) -> None:
        """Refresh status once and notify."""
        session = self._get_session()
        if session is None:
            return
        try:
            servers = _extract_servers(await session.rpc.mcp.list())
        except Exception as e:
            logger.debug(f"[{self.session_id}] mcp.list() reconcile failed for '{server_name}': {e}")
            return
        srv = next((s for s in servers if getattr(s, "name", None) == server_name), None)
        status = _status_value(getattr(srv, "status", None)) if srv is not None else None
        err = getattr(srv, "error", None) if srv is not None else None
        self._publish_status(server_name, status, err)
        if completed and status in TERMINAL_OK:
            self._notify("mcp_oauth_completed", {
                "sessionId": self.session_id,
                "serverName": server_name,
                "status": status,
            })


def _extract_servers(result: Any) -> list:
    """Normalize the result of ``mcp.list()`` to a plain list of server objects.

    SDK 0.3.0 returns an ``MCPServerList`` dataclass with a ``.servers`` attr.
    Older shapes returned a bare list. Tolerate both.
    """
    if result is None:
        return []
    inner = getattr(result, "servers", None)
    if inner is not None:
        return list(inner)
    if isinstance(result, list):
        return result
    return []


def _status_value(status: Any) -> str | None:
    """Coerce SDK enum or string status into a plain string."""
    if status is None:
        return None
    return getattr(status, "value", None) or str(status)
