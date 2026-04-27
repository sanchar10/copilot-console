"""Phase 4: YAML-driven Mermaid overlay (`visualize_overlay`).

Pure-function tests — no Workflow build, no agent resolution. Verifies that
the overlay surfaces declarative semantics that AF's built-in mermaid loses:
  * ``If``/``Switch``/``ConditionGroup`` render as diamond decision nodes
    with branch labels on the outgoing edges.
  * ``Foreach``/``RepeatUntil`` render as subgraph blocks.
  * ``TryCatch`` renders as a subgraph containing try/catch/finally lanes.
  * Plain workflows (``emoji-poem`` regression) render as a sequential chain
    of rectangles.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from copilot_console.app.services.workflow_engine import workflow_engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _render(yaml_text: str) -> str:
    return workflow_engine.visualize_overlay(yaml_text)


def _starts_clean(out: str) -> None:
    assert out.startswith("flowchart TD\n"), out
    assert "Start" in out
    assert "End" in out


# ---------------------------------------------------------------------------
# Plain sequential workflow (emoji-poem regression)
# ---------------------------------------------------------------------------


YAML_EMOJI_POEM = """
kind: Workflow
name: emoji-poem
description: Writes a poem on any topic and illustrates it with inline emoji
trigger:
  kind: OnConversationStart
  id: emoji_poem
  actions:
    - kind: InvokeAzureAgent
      id: write
      agent:
        name: Creative Poet
    - kind: InvokeAzureAgent
      id: illustrate
      agent:
        name: Emoji Illustrator
"""


def test_overlay_emoji_poem_renders_sequential_rectangles():
    out = _render(YAML_EMOJI_POEM)
    _starts_clean(out)
    # Both action ids appear, each labelled with the kind.
    assert "write (InvokeAzureAgent)" in out
    assert "illustrate (InvokeAzureAgent)" in out
    # No diamond / subgraph noise for a plain sequential workflow.
    assert "{" not in out.replace("flowchart TD", "")
    assert "subgraph" not in out


# ---------------------------------------------------------------------------
# Branching: If
# ---------------------------------------------------------------------------


YAML_IF = """
kind: Workflow
name: branching
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SetValue
      id: prep
      value: 1
    - kind: If
      id: branch
      condition: =Local.prep > 0
      then:
        - kind: SendActivity
          id: yes_path
          activity: positive
      else:
        - kind: SendActivity
          id: no_path
          activity: negative
"""


def test_overlay_if_renders_diamond_with_then_and_else_labels():
    out = _render(YAML_IF)
    _starts_clean(out)
    # Diamond syntax appears (``{"label"}``).
    assert "{\"branch (If)\"}" in out
    # Both branches labelled on outgoing edges.
    assert "|then|" in out
    assert "|else|" in out
    # Branch contents present.
    assert "yes_path (SendActivity)" in out
    assert "no_path (SendActivity)" in out


# ---------------------------------------------------------------------------
# Branching: Switch
# ---------------------------------------------------------------------------


YAML_SWITCH = """
kind: Workflow
name: switching
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: Switch
      id: pick
      value: =Local.kind
      cases:
        - match: A
          actions:
            - kind: SendActivity
              id: handle_a
              activity: a-msg
        - match: B
          actions:
            - kind: SendActivity
              id: handle_b
              activity: b-msg
      default:
        - kind: SendActivity
          id: handle_default
          activity: default-msg
"""


def test_overlay_switch_renders_diamond_with_case_labels_and_default():
    out = _render(YAML_SWITCH)
    _starts_clean(out)
    assert "{\"pick (Switch)\"}" in out
    assert "|A|" in out and "|B|" in out
    assert "|default|" in out
    assert "handle_a (SendActivity)" in out
    assert "handle_b (SendActivity)" in out
    assert "handle_default (SendActivity)" in out


# ---------------------------------------------------------------------------
# Branching: ConditionGroup
# ---------------------------------------------------------------------------


YAML_CONDITION_GROUP = """
kind: Workflow
name: cg
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: ConditionGroup
      id: cg
      conditions:
        - condition: =Local.x > 10
          actions:
            - kind: SendActivity
              id: big
              activity: big
        - condition: =Local.x > 0
          actions:
            - kind: SendActivity
              id: small
              activity: small
      elseActions:
        - kind: SendActivity
          id: zero
          activity: zero
"""


def test_overlay_condition_group_renders_diamond_with_condition_labels():
    out = _render(YAML_CONDITION_GROUP)
    _starts_clean(out)
    assert "{\"cg (ConditionGroup)\"}" in out
    # Branch edges labelled with the condition expressions and an else.
    assert "Local.x > 10" in out
    assert "Local.x > 0" in out
    assert "|else|" in out
    assert "big (SendActivity)" in out
    assert "small (SendActivity)" in out
    assert "zero (SendActivity)" in out


# ---------------------------------------------------------------------------
# Loop: Foreach
# ---------------------------------------------------------------------------


YAML_FOREACH = """
kind: Workflow
name: loopy
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: Foreach
      id: loop
      source: =Local.items
      actions:
        - kind: SendActivity
          id: inner
          activity: =Local.item
"""


def test_overlay_foreach_renders_subgraph_with_body():
    out = _render(YAML_FOREACH)
    _starts_clean(out)
    assert "subgraph" in out
    assert "loop (Foreach)" in out
    assert "inner (SendActivity)" in out
    # Subgraph block is closed.
    assert "\n    end" in out


# ---------------------------------------------------------------------------
# Loop: RepeatUntil
# ---------------------------------------------------------------------------


YAML_REPEAT_UNTIL = """
kind: Workflow
name: repeating
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: RepeatUntil
      id: loop
      condition: =Local.done
      actions:
        - kind: SendActivity
          id: tick
          activity: hi
"""


def test_overlay_repeat_until_renders_subgraph():
    out = _render(YAML_REPEAT_UNTIL)
    _starts_clean(out)
    assert "subgraph" in out
    assert "loop (RepeatUntil)" in out
    assert "tick (SendActivity)" in out


# ---------------------------------------------------------------------------
# TryCatch
# ---------------------------------------------------------------------------


YAML_TRY_CATCH = """
kind: Workflow
name: safe
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: TryCatch
      id: safety
      try:
        - kind: SendActivity
          id: risky
          activity: doing risky thing
      catch:
        - kind: SendActivity
          id: handler
          activity: =Local.error.message
      finally:
        - kind: SendActivity
          id: cleanup
          activity: cleanup
"""


def test_overlay_trycatch_renders_three_lanes():
    out = _render(YAML_TRY_CATCH)
    _starts_clean(out)
    assert "safety (TryCatch)" in out
    # Lane subgraph titles appear verbatim.
    assert '["try"]' in out
    assert '["catch"]' in out
    assert '["finally"]' in out
    assert "risky (SendActivity)" in out
    assert "handler (SendActivity)" in out
    assert "cleanup (SendActivity)" in out


# ---------------------------------------------------------------------------
# Defensive paths
# ---------------------------------------------------------------------------


def test_overlay_handles_invalid_yaml_gracefully():
    out = _render("not: valid: yaml: [unclosed")
    assert out.startswith("flowchart TD")
    assert "YAML parse error" in out


def test_overlay_handles_empty_actions():
    out = _render(
        """
kind: Workflow
name: empty
trigger:
  kind: OnConversationStart
  id: t
  actions: []
"""
    )
    _starts_clean(out)
    # Start connects directly to End when there are no actions.
    assert "n_start --> n_end" in out


def test_overlay_handles_missing_trigger():
    out = _render("kind: Workflow\nname: lonely\n")
    _starts_clean(out)


def test_overlay_escapes_quote_and_bracket_chars_in_labels():
    yaml_text = """
kind: Workflow
name: quoted
trigger:
  kind: OnConversationStart
  id: t
  actions:
    - kind: SendActivity
      id: 'weird "id" [with] {chars}'
      activity: hi
"""
    out = _render(yaml_text)
    # The inner double-quote was replaced with single-quote so the node
    # bracket form `["..."]` doesn't break parsing.
    assert "[\"weird 'id' (with) (chars) (SendActivity)\"]" in out
