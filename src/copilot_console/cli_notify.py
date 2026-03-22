"""CLI Notify — toggle mobile push notifications for CLI sessions.

Usage (from Copilot CLI via ! prefix):
  !cli-notify on     Enable notifications for all CLI sessions
  !cli-notify off    Disable notifications
  !cli-notify        Show current status

Internal (called by CLI agentStop hook):
  cli-notify hook agent-stop   Read hook input from stdin, call Console API
"""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

# Paths
APP_HOME = Path.home() / ".copilot-console"
COPILOT_HOME = Path.home() / ".copilot"
SETTINGS_FILE = APP_HOME / "settings.json"
HOOKS_DIR = COPILOT_HOME / "hooks"
HOOK_CONFIG_FILE = HOOKS_DIR / "console-notifications.json"

DEFAULT_PORT = 8765

HOOK_CONFIG = {
    "version": 1,
    "hooks": {
        "agentStop": [
            {
                "type": "command",
                "bash": "cli-notify hook agent-stop",
                "powershell": "cli-notify hook agent-stop",
                "timeoutSec": 10,
            }
        ]
    },
}


def _read_settings() -> dict:
    """Read settings from ~/.copilot-console/settings.json."""
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _write_settings(settings: dict) -> None:
    """Write settings to ~/.copilot-console/settings.json."""
    APP_HOME.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _is_enabled() -> bool:
    """Check if CLI notifications are enabled."""
    return _read_settings().get("cli_notifications", False)


def _create_hook_config() -> None:
    """Create the agentStop hook config at ~/.copilot/hooks/."""
    HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    HOOK_CONFIG_FILE.write_text(json.dumps(HOOK_CONFIG, indent=2), encoding="utf-8")


def _remove_hook_config() -> None:
    """Remove the hook config file."""
    if HOOK_CONFIG_FILE.exists():
        HOOK_CONFIG_FILE.unlink()


def _get_port() -> int:
    """Get the Console backend port from settings."""
    settings = _read_settings()
    return settings.get("server_port", DEFAULT_PORT)


def cmd_on() -> None:
    """Enable CLI notifications."""
    settings = _read_settings()
    settings["cli_notifications"] = True
    _write_settings(settings)
    _create_hook_config()
    print("[OK] CLI notifications enabled")
    print("  Mobile push notifications will be sent when Copilot completes in any CLI session.")


def cmd_off() -> None:
    """Disable CLI notifications."""
    settings = _read_settings()
    settings["cli_notifications"] = False
    _write_settings(settings)
    _remove_hook_config()
    print("[OK] CLI notifications disabled")


def cmd_status() -> None:
    """Show current notification status."""
    enabled = _is_enabled()
    hook_exists = HOOK_CONFIG_FILE.exists()
    print(f"CLI notifications: {'ON' if enabled else 'OFF'}")
    if enabled and not hook_exists:
        print("WARNING: Run 'cli-notify on' to repair configuration.")
    elif not enabled and hook_exists:
        print("WARNING: Run 'cli-notify off' to clean up.")

    # Check if Console backend is reachable
    port = _get_port()
    try:
        req = urllib.request.Request(f"http://localhost:{port}/health", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()
        print(f"Copilot Console: running (localhost:{port})")
    except (urllib.error.URLError, OSError):
        print(f"Copilot Console: not running (localhost:{port})")
        if enabled:
            print("  Notifications will not be delivered until Console is started.")


def cmd_hook_agent_stop() -> None:
    """Handle agentStop hook — read stdin, call Console API.

    Called by CLI hook, not by user directly.
    Input on stdin: {"sessionId": "...", "timestamp": ..., "stopReason": "..."}
    """
    if not _is_enabled():
        return

    # Read hook input from stdin
    try:
        raw = sys.stdin.read()
        hook_input = json.loads(raw)
    except Exception:
        return

    session_id = hook_input.get("sessionId")
    if not session_id:
        return

    # Call Console API
    port = _get_port()
    url = f"http://localhost:{port}/api/cli-hooks/agent-stop"
    payload = json.dumps({"session_id": session_id}).encode("utf-8")

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except (urllib.error.URLError, OSError):
        # Console not running — silently ignore
        pass


def main() -> None:
    """Entry point for cli-notify command."""
    args = sys.argv[1:]

    if not args:
        cmd_status()
    elif args[0] == "on":
        cmd_on()
    elif args[0] == "off":
        cmd_off()
    elif args[0] == "hook" and len(args) > 1 and args[1] == "agent-stop":
        cmd_hook_agent_stop()
    else:
        print(f"Unknown command: {' '.join(args)}")
        print("Usage: cli-notify [on|off]")
        sys.exit(1)


if __name__ == "__main__":
    main()
