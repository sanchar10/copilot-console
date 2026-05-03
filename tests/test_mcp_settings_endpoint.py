"""Tests for GET/PATCH /api/mcp/settings endpoints (Phase 3 Slice 3)."""

from __future__ import annotations


def test_get_settings_default_empty(client):
    resp = client.get("/api/mcp/settings")
    assert resp.status_code == 200
    assert resp.json() == {"mcp_auto_enable": {}}


def test_patch_sets_single_entry(client):
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True}})
    assert resp.status_code == 200
    assert resp.json() == {"mcp_auto_enable": {"fs": True}}

    # Verify GET reflects it
    assert client.get("/api/mcp/settings").json() == {"mcp_auto_enable": {"fs": True}}


def test_patch_preserves_unrelated_entries(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True, "github": False}})
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"bluebird": True}})
    assert resp.status_code == 200
    assert resp.json()["mcp_auto_enable"] == {
        "fs": True,
        "github": False,
        "bluebird": True,
    }


def test_patch_can_overwrite_existing_entry(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True}})
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": False}})
    assert resp.json()["mcp_auto_enable"] == {"fs": False}


def test_patch_null_removes_entry(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True, "github": True}})
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": None}})
    assert resp.status_code == 200
    assert resp.json()["mcp_auto_enable"] == {"github": True}


def test_patch_null_on_missing_key_is_noop(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True}})
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"never-existed": None}})
    assert resp.status_code == 200
    assert resp.json()["mcp_auto_enable"] == {"fs": True}


def test_patch_with_omitted_body_field_is_noop(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True}})
    resp = client.patch("/api/mcp/settings", json={})
    assert resp.status_code == 200
    assert resp.json()["mcp_auto_enable"] == {"fs": True}


def test_patch_combined_set_and_remove_in_one_call(client):
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"old": True, "keep": True}})
    resp = client.patch(
        "/api/mcp/settings",
        json={"mcp_auto_enable": {"old": None, "new": True, "keep": False}},
    )
    assert resp.json()["mcp_auto_enable"] == {"keep": False, "new": True}


def test_patch_does_not_clobber_other_top_level_settings(client):
    """Critical invariant from S2: a PATCH to /mcp/settings must NOT lose
    sibling top-level settings keys like default_model."""
    # Seed an unrelated setting via the main settings endpoint
    client.patch("/api/settings", json={"default_model": "claude-test"})
    # Now patch MCP settings
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"fs": True}})
    # default_model must survive
    full = client.get("/api/settings").json()
    assert full["default_model"] == "claude-test"
    assert full["mcp_auto_enable"] == {"fs": True}


# ---------- Validation ----------


def test_patch_rejects_empty_name(client):
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"": True}})
    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


def test_patch_rejects_name_with_spaces(client):
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"my server": True}})
    assert resp.status_code == 400


def test_patch_rejects_name_with_path_traversal(client):
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"../etc/passwd": True}})
    assert resp.status_code == 400


def test_patch_rejects_overlong_name(client):
    long_name = "a" * 65
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {long_name: True}})
    assert resp.status_code == 400


def test_patch_accepts_dotted_name(client):
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"co.example.tool": True}})
    assert resp.status_code == 200


def test_patch_accepts_hyphen_underscore_name(client):
    resp = client.patch(
        "/api/mcp/settings",
        json={"mcp_auto_enable": {"my-server_v2": True}},
    )
    assert resp.status_code == 200


def test_patch_validation_failure_does_not_persist_partial_writes(client):
    """If one name in the patch is invalid, none of the entries should land."""
    client.patch("/api/mcp/settings", json={"mcp_auto_enable": {"existing": True}})
    resp = client.patch(
        "/api/mcp/settings",
        json={"mcp_auto_enable": {"good": True, "bad name": True}},
    )
    assert resp.status_code == 400
    # Verify nothing changed
    assert client.get("/api/mcp/settings").json() == {"mcp_auto_enable": {"existing": True}}


def test_patch_rejects_too_many_entries(client):
    huge = {f"server-{i}": True for i in range(501)}
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": huge})
    assert resp.status_code == 413


def test_patch_accepts_max_entries(client):
    payload = {f"server-{i}": True for i in range(500)}
    resp = client.patch("/api/mcp/settings", json={"mcp_auto_enable": payload})
    assert resp.status_code == 200
