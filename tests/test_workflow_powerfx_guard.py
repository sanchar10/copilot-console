"""Phase 3: PowerFx availability probe + YAML expression walker + validate guard.

Covers:
* `_probe_powerfx` returns True when import + Engine() succeed; False on either failure.
* `_yaml_uses_expressions` walker catches expressions in every nested location
  AF would actually evaluate them (top-level, quoted, list items, nested dicts,
  conditional clauses) and does NOT false-positive on plain strings that
  happen to start with characters other than '='.
* `validate_yaml` short-circuits with a clear, actionable error when PowerFx
  is unavailable AND the YAML contains expressions; passes through to the
  normal load path otherwise.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from copilot_console.app.services import workflow_engine as wfe
from copilot_console.app.services.workflow_engine import (
    _probe_powerfx,
    _yaml_uses_expressions,
    workflow_engine,
)


# ---------------------------------------------------------------------------
# _probe_powerfx
# ---------------------------------------------------------------------------


def test_probe_powerfx_returns_false_on_import_error(monkeypatch):
    """Import failure => probe returns False without raising."""
    real_import = __import__

    def fake_import(name, *args, **kwargs):
        if name == "powerfx":
            raise ImportError("simulated: no powerfx wheel for this interpreter")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", fake_import)
    assert _probe_powerfx() is False


def test_probe_powerfx_returns_false_on_engine_runtime_error(monkeypatch):
    """Import succeeds but Engine() raises => probe returns False."""
    import types as _t

    fake = _t.ModuleType("powerfx")

    class _BadEngine:
        def __init__(self, *a, **kw):
            raise RuntimeError("simulated native init failure")

    fake.Engine = _BadEngine  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "powerfx", fake)
    assert _probe_powerfx() is False


def test_probe_powerfx_returns_true_when_engine_constructs(monkeypatch):
    """Both import and Engine() succeed => probe returns True."""
    import types as _t

    fake = _t.ModuleType("powerfx")

    class _OkEngine:
        def __init__(self, *a, **kw):
            pass

    fake.Engine = _OkEngine  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "powerfx", fake)
    assert _probe_powerfx() is True


# ---------------------------------------------------------------------------
# _yaml_uses_expressions walker
# ---------------------------------------------------------------------------


def test_walker_detects_top_level_expression():
    yaml_text = """
kind: Workflow
name: t
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: =Sum(1, 2)
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_detects_quoted_expression():
    """Double-quoted scalars are still strings post-parse."""
    yaml_text = """
kind: Workflow
name: t
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: "=If(true, 1, 2)"
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_detects_list_item_expression():
    yaml_text = """
kind: Workflow
name: t
items:
  - plain
  - =Concatenate('a', 'b')
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_detects_nested_condition_expression():
    yaml_text = """
kind: Workflow
name: t
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: ConditionGroup
      id: c
      conditions:
        - condition: =state.count > 0
          actions: []
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_detects_lowercase_scope_expression():
    """Walker is value-driven; key casing doesn't matter."""
    yaml_text = """
kind: Workflow
name: t
foo:
  bar:
    baz: =now()
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_no_false_positive_on_plain_strings():
    yaml_text = """
kind: Workflow
name: emoji-poem
description: Writes a poem with leading text only
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: InvokeAzureAgent
      id: write
      agent:
        name: Creative Poet
"""
    assert _yaml_uses_expressions(yaml_text) is False


def test_walker_ignores_leading_whitespace_only_when_no_equal():
    """A scalar that's whitespace + non-'=' must NOT trigger."""
    yaml_text = """
kind: Workflow
name: t
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: '   plain text'
"""
    assert _yaml_uses_expressions(yaml_text) is False


def test_walker_strips_leading_whitespace_before_equal():
    """`'   =expr'` is still an expression — walker should lstrip."""
    yaml_text = """
kind: Workflow
name: t
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: '   =1+1'
"""
    assert _yaml_uses_expressions(yaml_text) is True


def test_walker_returns_false_on_invalid_yaml():
    """Parse failures don't cascade; the loader will surface a better error."""
    assert _yaml_uses_expressions("not: valid: yaml: [unclosed") is False


def test_walker_returns_false_on_empty_input():
    assert _yaml_uses_expressions("") is False


# ---------------------------------------------------------------------------
# validate_yaml guard
# ---------------------------------------------------------------------------


YAML_WITH_EXPR = """
kind: Workflow
name: expr-flow
description: uses an expression
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: =Sum(1, 2)
"""


YAML_NO_EXPR = """
kind: Workflow
name: plain-flow
description: literals only
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: a
      value: hello
"""


def test_validate_yaml_rejects_expression_when_powerfx_unavailable(monkeypatch):
    monkeypatch.setattr(wfe, "POWERFX_AVAILABLE", False)
    result = workflow_engine.validate_yaml(YAML_WITH_EXPR)
    assert result["valid"] is False
    err = result["error"].lower()
    assert "power fx" in err or "powerfx" in err
    # Mention of '=' or interpreter context so users know the next step.
    assert "=" in result["error"] or "python" in err


def test_validate_yaml_skips_guard_when_powerfx_available(monkeypatch):
    """When PowerFx IS available, guard does not short-circuit; the normal
    loader runs (and may itself fail for unrelated reasons, but NOT with the
    PowerFx-unavailable message)."""
    monkeypatch.setattr(wfe, "POWERFX_AVAILABLE", True)
    result = workflow_engine.validate_yaml(YAML_WITH_EXPR)
    if result["valid"] is False:
        assert "Power Fx" not in result["error"]
        assert "powerfx" not in result["error"].lower()


def test_validate_yaml_passes_through_for_literal_only_yaml(monkeypatch):
    """Even with PowerFx unavailable, expression-free YAML is NOT rejected by
    the guard. (It may still fail later in load_from_yaml_string for other
    reasons; we just assert the guard didn't fire.)"""
    monkeypatch.setattr(wfe, "POWERFX_AVAILABLE", False)
    result = workflow_engine.validate_yaml(YAML_NO_EXPR)
    if result["valid"] is False:
        assert "Power Fx" not in result["error"]
        assert "powerfx" not in result["error"].lower()


def test_validate_yaml_invalid_yaml_skips_guard_and_falls_through(monkeypatch):
    """Malformed YAML => walker returns False => loader produces the parse
    error, not the PowerFx message."""
    monkeypatch.setattr(wfe, "POWERFX_AVAILABLE", False)
    result = workflow_engine.validate_yaml("not: valid: yaml: [unclosed")
    assert result["valid"] is False
    assert "Power Fx" not in result["error"]
