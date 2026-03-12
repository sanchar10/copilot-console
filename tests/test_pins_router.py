"""Tests for pins router."""

from __future__ import annotations


def test_pins_crud(client):
    session_id = "test-session-123"

    # Empty list
    resp = client.get(f"/api/sessions/{session_id}/pins")
    assert resp.status_code == 200
    assert resp.json() == {"pins": []}

    # Create requires sdk_message_id
    resp = client.post(f"/api/sessions/{session_id}/pins", json={})
    assert resp.status_code in (400, 422)

    # Create
    resp = client.post(
        f"/api/sessions/{session_id}/pins",
        json={"sdk_message_id": "mid_abc", "title": "T", "excerpt": "E"},
    )
    assert resp.status_code == 200
    pin = resp.json()
    assert pin["session_id"] == session_id
    assert pin["sdk_message_id"] == "mid_abc"
    assert pin["title"] == "T"
    assert pin["excerpt"] == "E"
    assert pin["id"].startswith("pin_")

    pin_id = pin["id"]

    # List shows it
    resp = client.get(f"/api/sessions/{session_id}/pins")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["pins"]) == 1
    assert data["pins"][0]["id"] == pin_id

    # Update
    resp = client.patch(f"/api/sessions/{session_id}/pins/{pin_id}", json={"note": "N"})
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["note"] == "N"

    # Delete
    resp = client.delete(f"/api/sessions/{session_id}/pins/{pin_id}")
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # Gone
    resp = client.get(f"/api/sessions/{session_id}/pins")
    assert resp.status_code == 200
    assert resp.json() == {"pins": []}
