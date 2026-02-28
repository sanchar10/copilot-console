"""Configuration and constants."""

import os
from pathlib import Path

# Base storage directory
APP_HOME = Path(os.environ.get("COPILOT_CONSOLE_HOME", Path.home() / ".copilot-console"))

# SDK session state directory (where Copilot CLI stores sessions)
COPILOT_SESSION_STATE = Path.home() / ".copilot" / "session-state"

# Sub-directories
SESSIONS_DIR = APP_HOME / "sessions"
TOOLS_DIR = APP_HOME / "tools"
MCP_SERVERS_DIR = APP_HOME / "mcp-servers"
AGENTS_DIR = APP_HOME / "agents"
AUTOMATIONS_DIR = APP_HOME / "automations"
TASK_RUNS_DIR = APP_HOME / "task-runs"

# Metadata file
METADATA_FILE = APP_HOME / "metadata.json"
SETTINGS_FILE = APP_HOME / "settings.json"
PROJECTS_FILE = APP_HOME / "projects.json"

# Supported models (from Copilot SDK documentation)
DEFAULT_MODELS = [
    "gpt-4.1",
    "gpt-4o",
    "gpt-4",
    "claude-sonnet-4",
]

# Default model for new sessions
DEFAULT_MODEL = "gpt-4.1"

# Default working directory for new sessions (user's home)
DEFAULT_CWD = str(Path.home())

# Default timeout (seconds) for each workflow step (agent invocation)
DEFAULT_WORKFLOW_STEP_TIMEOUT = 600  # 10 minutes

# API settings
API_PREFIX = "/api"


def ensure_directories() -> None:
    """Create required directories if they don't exist."""
    for directory in [APP_HOME, SESSIONS_DIR, TOOLS_DIR, MCP_SERVERS_DIR, AGENTS_DIR, AUTOMATIONS_DIR, TASK_RUNS_DIR]:
        directory.mkdir(parents=True, exist_ok=True)
