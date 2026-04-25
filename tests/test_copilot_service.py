"""Pre-refactor characterization tests for CopilotService.

These tests capture the current public API surface of CopilotService
BEFORE it gets split/restructured. They serve as a safety net: if any
test breaks after refactoring, the refactor changed observable behavior.

All external dependencies (SDK, file I/O) are mocked — no real API calls.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fresh_config(monkeypatch, tmp_path: Path):
    """Monkeypatch config module constants to point at tmp_path."""
    agent_home = tmp_path / "home"
    sessions_dir = agent_home / "sessions"
    settings_file = agent_home / "settings.json"
    metadata_file = agent_home / "metadata.json"
    agent_home.mkdir(parents=True, exist_ok=True)

    for mod in list(sys.modules):
        if mod.startswith("copilot_console.app"):
            sys.modules.pop(mod, None)

    monkeypatch.setenv("copilot_console_HOME", str(agent_home))

    import copilot_console.app.config as cfg

    monkeypatch.setattr(cfg, "APP_HOME", agent_home)
    monkeypatch.setattr(cfg, "SESSIONS_DIR", sessions_dir)
    monkeypatch.setattr(cfg, "SETTINGS_FILE", settings_file)
    monkeypatch.setattr(cfg, "METADATA_FILE", metadata_file)

    return cfg


def _make_copilot_service(monkeypatch, tmp_path):
    """Return a fresh CopilotService with mocked SDK."""
    _fresh_config(monkeypatch, tmp_path)
    from copilot_console.app.services.copilot_service import CopilotService
    svc = CopilotService()
    return svc


# ===================================================================
# CopilotService — Initialization & State
# ===================================================================

class TestCopilotServiceInit:
    """Verify CopilotService initializes with correct default state."""

    def test_init_no_clients(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc._main_client is None
        assert svc._main_started is False
        assert svc._session_clients == {}

    def test_init_empty_metadata_cache(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc._sdk_metadata_cache == {}

    def test_init_no_pending_elicitations(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        # After split, elicitations moved to ElicitationManager
        assert svc._elicitation_mgr._pending == {}

    def test_init_idle_timeout_default(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        # Bumped to 15min in 663b25c (MCP OAuth cold-only gate work) so OAuth
        # flows that take a few extra minutes don't get killed mid-sign-in.
        assert svc._idle_timeout_seconds == 900


# ===================================================================
# CopilotService — Session Active State
# ===================================================================

class TestCopilotServiceSessionState:
    """Test is_session_active / get_session_cwd / get_cached_session_metadata."""

    def test_is_session_active_false_initially(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.is_session_active("nonexistent") is False

    def test_is_session_active_true_when_client_exists(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        svc._session_clients["s1"] = MagicMock()
        assert svc.is_session_active("s1") is True

    def test_get_session_cwd_none_when_inactive(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.get_session_cwd("nonexistent") is None

    def test_get_session_cwd_returns_client_cwd(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        client = MagicMock()
        client.cwd = "/some/path"
        svc._session_clients["s1"] = client
        assert svc.get_session_cwd("s1") == "/some/path"

    def test_get_cached_session_metadata_none_initially(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.get_cached_session_metadata("s1") is None

    def test_get_cached_session_metadata_returns_cached(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        fake_meta = {"sessionId": "s1", "name": "Test"}
        svc._sdk_metadata_cache["s1"] = fake_meta
        assert svc.get_cached_session_metadata("s1") is fake_meta


# ===================================================================
# CopilotService — get_session_client
# ===================================================================

class TestGetSessionClient:
    """Test get_session_client creates/reuses/recreates clients."""

    def test_creates_new_client(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            client = await svc.get_session_client("s1", "/my/cwd")
            assert client.session_id == "s1"
            assert client.cwd == "/my/cwd"
            assert "s1" in svc._session_clients
        asyncio.run(_run())

    def test_reuses_existing_client_same_cwd(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            c1 = await svc.get_session_client("s1", "/cwd")
            c2 = await svc.get_session_client("s1", "/cwd")
            assert c1 is c2
        asyncio.run(_run())

    def test_recreates_client_on_cwd_change(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            from copilot_console.app.services.copilot_service import SessionClient

            # Inject a mock client that tracks stop() calls
            mock_client = MagicMock(spec=SessionClient)
            mock_client.cwd = "/old"
            mock_client.stop = AsyncMock()
            svc._session_clients["s1"] = mock_client

            c2 = await svc.get_session_client("s1", "/new")
            assert c2.cwd == "/new"
            assert c2 is not mock_client
            mock_client.stop.assert_awaited_once()
        asyncio.run(_run())


# ===================================================================
# CopilotService — destroy_session_client
# ===================================================================

class TestDestroySessionClient:
    """Test destroy_session_client cleanup behavior."""

    def test_destroy_removes_client(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            from copilot_console.app.services.copilot_service import SessionClient

            mock_client = MagicMock(spec=SessionClient)
            mock_client.stop = AsyncMock()
            mock_client.event_queue = MagicMock()
            svc._session_clients["s1"] = mock_client

            await svc.destroy_session_client("s1")

            assert "s1" not in svc._session_clients
            mock_client.stop.assert_awaited_once()
            assert mock_client.event_queue is None
        asyncio.run(_run())

    def test_destroy_nonexistent_is_noop(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            # Should not raise
            await svc.destroy_session_client("nonexistent")
        asyncio.run(_run())

    def test_destroy_clears_msg_lock(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._session_msg_locks["s1"] = asyncio.Lock()

            mock_client = MagicMock()
            mock_client.stop = AsyncMock()
            mock_client.event_queue = None
            svc._session_clients["s1"] = mock_client

            await svc.destroy_session_client("s1")
            assert "s1" not in svc._session_msg_locks
        asyncio.run(_run())


# ===================================================================
# CopilotService — Elicitation management
# ===================================================================

class TestElicitationManagement:
    """Test resolve/cancel elicitation methods."""

    def test_resolve_elicitation_success(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        svc._elicitation_mgr._pending[("s1", "req-1")] = future

        result = svc.resolve_elicitation("s1", "req-1", {"answer": "yes"})
        assert result is True
        assert future.result() == {"answer": "yes"}
        assert ("s1", "req-1") not in svc._elicitation_mgr._pending
        loop.close()

    def test_resolve_elicitation_not_found(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.resolve_elicitation("s1", "nope", {}) is False

    def test_cancel_elicitation_success(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        loop = asyncio.new_event_loop()
        future = loop.create_future()
        svc._elicitation_mgr._pending[("s1", "req-1")] = future

        result = svc.cancel_elicitation("s1", "req-1")
        assert result is True
        assert future.cancelled()
        loop.close()

    def test_cancel_elicitation_not_found(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.cancel_elicitation("s1", "nope") is False

    def test_cancel_pending_elicitations_clears_all_for_session(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        loop = asyncio.new_event_loop()
        f1 = loop.create_future()
        f2 = loop.create_future()
        f3 = loop.create_future()  # different session
        svc._elicitation_mgr._pending[("s1", "a")] = f1
        svc._elicitation_mgr._pending[("s1", "b")] = f2
        svc._elicitation_mgr._pending[("s2", "c")] = f3

        cancelled = svc.cancel_pending_elicitations("s1")
        assert cancelled == 2
        assert ("s1", "a") not in svc._elicitation_mgr._pending
        assert ("s1", "b") not in svc._elicitation_mgr._pending
        # Other session untouched
        assert ("s2", "c") in svc._elicitation_mgr._pending
        loop.close()

    def test_cancel_pending_elicitations_none_to_cancel(self, monkeypatch, tmp_path):
        svc = _make_copilot_service(monkeypatch, tmp_path)
        assert svc.cancel_pending_elicitations("s1") == 0


# ===================================================================
# CopilotService — get_models with caching
# ===================================================================

class TestGetModels:
    """Test get_models caching behavior."""

    def test_get_models_returns_cached_within_ttl(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._models_cache = [{"id": "cached-model", "name": "Cached"}]
            svc._models_cache_time = time.time()  # fresh

            result = await svc.get_models()
            assert result == [{"id": "cached-model", "name": "Cached"}]
        asyncio.run(_run())

    def test_get_models_cache_expired_refetches(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._models_cache = [{"id": "old", "name": "Old"}]
            svc._models_cache_time = time.time() - 700  # expired

            # Mock start and list_models
            svc._start_main_client = AsyncMock()
            mock_model = MagicMock()
            mock_model.id = "new-model"
            mock_model.name = "New Model"
            mock_model.supported_reasoning_efforts = None
            mock_model.default_reasoning_effort = None
            svc._main_client = MagicMock()
            svc._main_client.list_models = AsyncMock(return_value=[mock_model])

            result = await svc.get_models()
            assert len(result) == 1
            assert result[0]["id"] == "new-model"
        asyncio.run(_run())


# ===================================================================
# CopilotService — stop() cleanup
# ===================================================================

class TestCopilotServiceStop:
    """Test stop() tears down all resources."""

    def test_stop_clears_all_session_clients(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._lock = asyncio.Lock()

            mock_c1 = MagicMock()
            mock_c1.stop = AsyncMock()
            mock_c2 = MagicMock()
            mock_c2.stop = AsyncMock()
            svc._session_clients = {"s1": mock_c1, "s2": mock_c2}

            svc._main_client = MagicMock()
            svc._main_client.stop = AsyncMock()
            svc._main_started = True

            await svc.stop()

            assert svc._session_clients == {}
            mock_c1.stop.assert_awaited_once()
            mock_c2.stop.assert_awaited_once()
            assert svc._main_client is None
            assert svc._main_started is False
        asyncio.run(_run())


# ===================================================================
# CopilotService — enqueue_message / abort_session
# ===================================================================

class TestEnqueueAndAbort:
    """Test enqueue_message and abort_session require active sessions."""

    def test_enqueue_message_no_active_session_raises(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            with pytest.raises(ValueError, match="No active session"):
                await svc.enqueue_message("s1", "hello")
        asyncio.run(_run())

    def test_abort_session_no_active_session_raises(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            with pytest.raises(ValueError, match="No active session"):
                await svc.abort_session("s1")
        asyncio.run(_run())

    def test_enqueue_message_delegates_to_sdk(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)

            mock_session = MagicMock()
            mock_session.send = AsyncMock(return_value="msg-123")

            mock_client = MagicMock()
            mock_client.session = mock_session
            mock_client.touch = MagicMock()
            svc._session_clients["s1"] = mock_client

            result = await svc.enqueue_message("s1", "do something")
            assert result["status"] == "enqueued"
            assert result["message_id"] == "msg-123"
            mock_session.send.assert_awaited_once()
        asyncio.run(_run())

    def test_abort_session_calls_sdk_abort(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)

            mock_session = MagicMock()
            mock_session.abort = AsyncMock()

            mock_client = MagicMock()
            mock_client.session = mock_session
            svc._session_clients["s1"] = mock_client

            result = await svc.abort_session("s1")
            assert result["status"] == "aborted"
            mock_session.abort.assert_awaited_once()
        asyncio.run(_run())


# ===================================================================
# CopilotService — idle cleanup
# ===================================================================

class TestIdleCleanup:
    """Test _cleanup_idle_sessions identifies stale clients."""

    def test_cleanup_destroys_idle_clients(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._lock = asyncio.Lock()
            svc._idle_timeout_seconds = 60

            mock_client = MagicMock()
            mock_client.last_activity = time.time() - 120  # idle 2 min
            mock_client.stop = AsyncMock()
            mock_client.event_queue = None
            svc._session_clients["s1"] = mock_client

            # Stub destroy to just remove
            svc.destroy_session_client = AsyncMock()

            await svc._cleanup_idle_sessions()
            svc.destroy_session_client.assert_awaited_once_with("s1")
        asyncio.run(_run())

    def test_cleanup_keeps_active_clients(self, monkeypatch, tmp_path):
        async def _run():
            svc = _make_copilot_service(monkeypatch, tmp_path)
            svc._lock = asyncio.Lock()
            svc._idle_timeout_seconds = 600

            mock_client = MagicMock()
            mock_client.last_activity = time.time()  # just active
            svc._session_clients["s1"] = mock_client

            svc.destroy_session_client = AsyncMock()

            await svc._cleanup_idle_sessions()
            svc.destroy_session_client.assert_not_awaited()
        asyncio.run(_run())


# ===================================================================
# SessionClient — unit tests
# ===================================================================

class TestSessionClient:
    """Test SessionClient wrapper class."""

    def test_init_state(self, monkeypatch, tmp_path):
        _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.copilot_service import SessionClient
        sc = SessionClient("s1", "/cwd")
        assert sc.session_id == "s1"
        assert sc.cwd == "/cwd"
        assert sc.client is None
        assert sc.session is None
        assert sc.started is False

    def test_last_activity_set_on_init(self, monkeypatch, tmp_path):
        _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.copilot_service import SessionClient
        sc = SessionClient("s1", "/cwd")
        assert isinstance(sc.last_activity, float)
        assert sc.last_activity > 0

    def test_event_queue_none_on_init(self, monkeypatch, tmp_path):
        _fresh_config(monkeypatch, tmp_path)
        from copilot_console.app.services.copilot_service import SessionClient
        sc = SessionClient("s1", "/cwd")
        assert sc.event_queue is None
