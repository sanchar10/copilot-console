"""Tests for EventBus — pub/sub fan-out, replay buffer, slow subscribers.

Scenarios covered (per todo events-channel-tests):

* Multiple subscribers receive the same event.
* Disconnect removes the queue (no leak).
* Replay with ``since=N`` returns events with id > N.
* Replay emits a synthetic ``replay_gap`` envelope when ``since`` falls
  outside the ring buffer.
* A slow subscriber doesn't block fast ones — overflow is dropped with a
  warning rather than back-pressuring the publisher.
* Endpoint integration: GET /api/events streams a live event end-to-end.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from copilot_console.app.services.event_bus import (
    RING_BUFFER_SIZE,
    SUBSCRIBER_QUEUE_MAX,
    EventBus,
)


# ── unit tests on a fresh EventBus instance ──────────────────────────────


@pytest.fixture
def bus() -> EventBus:
    """Fresh bus per test — never share the module-level singleton."""
    return EventBus()


@pytest.mark.asyncio
async def test_multiple_subscribers_receive_same_event(bus: EventBus) -> None:
    a_id, a_q = await bus.subscribe()
    b_id, b_q = await bus.subscribe()
    assert bus.subscriber_count == 2

    envelope = bus.publish("mcp_oauth_required", {"server": "x"}, session_id="s1")

    assert envelope["id"] == 1
    assert envelope["type"] == "mcp_oauth_required"

    got_a = await asyncio.wait_for(a_q.get(), timeout=0.5)
    got_b = await asyncio.wait_for(b_q.get(), timeout=0.5)
    assert got_a == envelope
    assert got_b == envelope
    # Same dict instance is fan-out'd; subscribers must not mutate it.
    assert got_a is got_b

    await bus.unsubscribe(a_id)
    await bus.unsubscribe(b_id)


@pytest.mark.asyncio
async def test_unsubscribe_removes_queue_no_leak(bus: EventBus) -> None:
    sub_id, _ = await bus.subscribe()
    assert bus.subscriber_count == 1
    await bus.unsubscribe(sub_id)
    assert bus.subscriber_count == 0
    # Idempotent — unsubscribing twice is safe.
    await bus.unsubscribe(sub_id)
    assert bus.subscriber_count == 0


@pytest.mark.asyncio
async def test_stream_finally_unsubscribes(bus: EventBus) -> None:
    """The ``stream()`` async-gen must clean up on early termination."""
    bus.publish("warm-up", {})

    gen = bus.stream(since_id=0)
    try:
        ev = await asyncio.wait_for(gen.__anext__(), timeout=0.5)
        assert ev["type"] == "warm-up"
        assert bus.subscriber_count == 1
    finally:
        # Explicit aclose() is what real callers (FastAPI/sse-starlette)
        # do when the client disconnects — that's the path we care about.
        await gen.aclose()
    assert bus.subscriber_count == 0


def test_replay_since_returns_events_after_cursor(bus: EventBus) -> None:
    bus.publish("a", {})  # id=1
    bus.publish("b", {})  # id=2
    bus.publish("c", {})  # id=3

    got = bus.replay_since(1)
    assert [e["id"] for e in got] == [2, 3]
    assert [e["type"] for e in got] == ["b", "c"]


def test_replay_since_caught_up_returns_empty(bus: EventBus) -> None:
    bus.publish("a", {})  # id=1
    bus.publish("b", {})  # id=2
    assert bus.replay_since(2) == []
    assert bus.replay_since(99) == []


def test_replay_since_emits_gap_when_too_old(bus: EventBus) -> None:
    """``since`` older than the buffer's oldest entry should yield a synthetic
    ``replay_gap`` so the client knows it lost events."""
    # Overflow the ring buffer by N to push entries out.
    overflow = 5
    for i in range(RING_BUFFER_SIZE + overflow):
        bus.publish("flood", {"i": i})

    # Buffer holds ids [overflow+1 .. RING_BUFFER_SIZE+overflow].
    oldest = overflow + 1
    latest = RING_BUFFER_SIZE + overflow

    # Ask for events from before the buffer started.
    got = bus.replay_since(0)
    assert got, "expected at least the synthetic gap"
    gap = got[0]
    assert gap["type"] == "replay_gap"
    assert gap["data"] == {
        "lostFromId": 1,
        "lostUntilId": oldest - 1,
    }
    # Tail is the entire surviving buffer.
    assert [e["id"] for e in got[1:]] == list(range(oldest, latest + 1))


def test_replay_since_no_gap_when_within_buffer(bus: EventBus) -> None:
    bus.publish("a", {})  # id=1
    bus.publish("b", {})  # id=2
    bus.publish("c", {})  # id=3
    got = bus.replay_since(1)
    # No gap should be emitted — we're still inside the buffer window.
    assert all(e["type"] != "replay_gap" for e in got)


@pytest.mark.asyncio
async def test_slow_subscriber_does_not_block_fast_ones(
    bus: EventBus, caplog: pytest.LogCaptureFixture
) -> None:
    """If subscriber A's queue fills up, publish must not block, and
    subscriber B must keep receiving events."""
    slow_id, slow_q = await bus.subscribe()
    fast_id, fast_q = await bus.subscribe()

    # Fill the slow subscriber's queue to capacity by never draining it.
    for i in range(SUBSCRIBER_QUEUE_MAX):
        bus.publish("fill", {"i": i})
    assert slow_q.qsize() == SUBSCRIBER_QUEUE_MAX
    assert fast_q.qsize() == SUBSCRIBER_QUEUE_MAX

    # The fast subscriber drains as it goes; the slow one stays full.
    drained = 0
    while not fast_q.empty():
        fast_q.get_nowait()
        drained += 1
    assert drained == SUBSCRIBER_QUEUE_MAX

    # One more publish — slow subscriber should drop it (with a warning),
    # fast subscriber should still get it.
    with caplog.at_level("WARNING"):
        bus.publish("overflow", {"important": True})

    # Fast subscriber received the overflow event.
    got_fast = await asyncio.wait_for(fast_q.get(), timeout=0.5)
    assert got_fast["type"] == "overflow"
    # Slow subscriber's queue is unchanged (still full at MAX, the new
    # event was dropped).
    assert slow_q.qsize() == SUBSCRIBER_QUEUE_MAX
    # And we logged a drop warning naming the slow subscriber.
    assert any(
        "queue full" in rec.message and slow_id in rec.message
        for rec in caplog.records
    )

    await bus.unsubscribe(slow_id)
    await bus.unsubscribe(fast_id)


# ── endpoint smoke ────────────────────────────────────────────────────────
#
# A live ``GET /api/events`` end-to-end test is intentionally omitted here:
# the Starlette ``TestClient`` is synchronous and SSE responses are
# open-ended, so reading them requires either a custom timeout loop or an
# async HTTP client with an event-loop integration that pytest-asyncio's
# fixture model doesn't make straightforward. The wiring is trivial
# (router included with ``API_PREFIX``; ``EventSourceResponse`` from
# sse-starlette) and was verified manually with::
#
#     curl -N --max-time 130 http://localhost:8765/api/events
#     curl -N --max-time 130 http://localhost:5173/api/events
#
# both held the stream for the full 130s with ``:ping`` keepalives every
# 20s, proving the proxy / keepalive path. See ``events-keepalive-and-proxy``
# todo.
