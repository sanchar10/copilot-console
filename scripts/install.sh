#!/usr/bin/env bash
# Copilot Console - One-click installer for macOS/Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash

set -euo pipefail

REPO="sanchar10/copilot-console"

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}  Copilot Console Installer${NC}"
echo -e "${GRAY}  ====================================${NC}"
echo ""

# --- Check Python ---
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}  [ERROR] Python 3 not found.${NC}"
    echo -e "${YELLOW}     Install from https://www.python.org/downloads/${NC}"
    exit 1
fi
PY_VERSION=$(python3 --version 2>&1 | sed 's/Python //')
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 11 ]; }; then
    echo -e "${RED}  [ERROR] Python 3.11+ required (found $PY_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}  [OK] Python $PY_VERSION${NC}"

# --- Check Node.js ---
if ! command -v node &> /dev/null; then
    echo -e "${RED}  [ERROR] Node.js not found.${NC}"
    echo -e "${YELLOW}     Install from https://nodejs.org/ (LTS recommended)${NC}"
    exit 1
fi
NODE_VERSION=$(node --version 2>&1 | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED}  [ERROR] Node.js 18+ required (found $NODE_VERSION)${NC}"
    exit 1
fi
echo -e "${GREEN}  [OK] Node.js $NODE_VERSION${NC}"

# --- Check/Install Copilot CLI ---
if ! command -v copilot &> /dev/null; then
    echo -e "${YELLOW}  Installing GitHub Copilot CLI...${NC}"
    # Try without sudo first, then with sudo (Linux often needs it for global installs)
    if npm install -g @github/copilot &> /dev/null 2>&1; then
        true  # success
    elif command -v sudo &> /dev/null; then
        echo -e "${GRAY}  Retrying with sudo...${NC}"
        sudo npm install -g @github/copilot &> /dev/null 2>&1 || true
    fi
    if ! command -v copilot &> /dev/null; then
        echo -e "${RED}  [ERROR] Failed to install Copilot CLI${NC}"
        echo -e "${YELLOW}     Try manually: sudo npm install -g @github/copilot${NC}"
        exit 1
    fi
fi
COPILOT_VERSION=$(copilot --version 2>&1 | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?' || echo "unknown")
echo -e "${GREEN}  [OK] Copilot CLI $COPILOT_VERSION${NC}"

# --- Install Copilot Console ---
echo ""
echo -e "${YELLOW}  Installing Copilot Console...${NC}"
echo ""

# Resolve latest wheel URL from GitHub releases
echo -e "${GRAY}  Fetching latest release...${NC}"
RELEASE_INFO=$(curl -fsSL -H "User-Agent: copilot-console-installer" \
    "https://api.github.com/repos/$REPO/releases/latest")
WHL_URL=$(echo "$RELEASE_INFO" | grep -o '"browser_download_url":\s*"[^"]*\.whl"' | head -n1 | cut -d'"' -f4)
if [ -z "$WHL_URL" ]; then
    echo -e "${RED}  [ERROR] No .whl found in latest release.${NC}"
    echo -e "${YELLOW}     Check https://github.com/$REPO/releases${NC}"
    exit 1
fi
TAG_NAME=$(echo "$RELEASE_INFO" | grep -o '"tag_name":\s*"[^"]*"' | head -n1 | cut -d'"' -f4)
echo -e "${GREEN}  [OK] Found $TAG_NAME${NC}"

echo ""
echo -e "${YELLOW}  ┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${YELLOW}  │  ⏳ This may take 3-5 minutes — please wait...     │${NC}"
echo -e "${YELLOW}  └─────────────────────────────────────────────────────┘${NC}"
echo ""

# --- Ensure pip is available (Ubuntu/Debian often ship without it) ---
if ! python3 -m pip --version &> /dev/null; then
    echo -e "${YELLOW}  pip not found — installing python3-pip...${NC}"
    if command -v apt-get &> /dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
    elif command -v yum &> /dev/null; then
        sudo yum install -y python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
    fi
    if ! python3 -m pip --version &> /dev/null; then
        echo -e "${RED}  [ERROR] Could not install pip. Install manually: sudo apt install python3-pip${NC}"
        exit 1
    fi
    echo -e "${GREEN}  [OK] pip installed${NC}"
fi

# Install Agent Framework (pre-release) — required for workflow orchestration
echo -e "${GRAY}  Installing Microsoft Agent Framework (pre-release)...${NC}"
AF_INSTALLED=false
# Detect virtualenv — --user is incompatible with venvs
PIP_USER_FLAG="--user"
if [ -n "${VIRTUAL_ENV:-}" ] || python3 -c "import sys; sys.exit(0 if sys.prefix != sys.base_prefix else 1)" 2>/dev/null; then
    PIP_USER_FLAG=""
fi
# PEP 668: Ubuntu 24.04+ marks system Python as externally-managed
PIP_BREAK_FLAG=""
PY_STDLIB=$(python3 -c "import sysconfig; print(sysconfig.get_path('stdlib'))" 2>/dev/null)
if [ -f "${PY_STDLIB}/EXTERNALLY-MANAGED" ] 2>/dev/null || [ -f "${PY_STDLIB}/../EXTERNALLY-MANAGED" ] 2>/dev/null; then
    PIP_BREAK_FLAG="--break-system-packages"
fi
if python3 -m pip install $PIP_USER_FLAG $PIP_BREAK_FLAG --quiet agent-framework --pre 2>&1; then
    AF_INSTALLED=true
    echo -e "${GREEN}  [OK] Agent Framework installed${NC}"
else
    echo -e "${YELLOW}  [WARN] Agent Framework install failed. Workflows may not work.${NC}"
    echo -e "${YELLOW}     Try manually: pip install agent-framework --pre${NC}"
fi

INSTALLED=false
USED_PIPX=false
if command -v pipx &> /dev/null; then
    pipx install --force "$WHL_URL" 2>&1 | grep -vE 'symlink|These apps' | grep -v '^$' | sed 's/^/  /' | sed "s/.*/  ${GRAY}&${NC}/"
    if [ $? -eq 0 ]; then
        INSTALLED=true
        USED_PIPX=true
    else
        echo -e "${YELLOW}  [WARN] pipx install failed, using pip instead...${NC}"
    fi
else
    echo -e "${YELLOW}  [WARN] pipx not found, using pip instead.${NC}"
fi
if [ "$INSTALLED" = false ]; then
    python3 -m pip install $PIP_USER_FLAG $PIP_BREAK_FLAG --no-cache-dir --ignore-installed "$WHL_URL" 2>&1 | \
        grep -E 'Downloading.*copilot.agent.console|Installing collected' | sed 's/^/  /' | sed "s/.*/  ${GRAY}&${NC}/"
    if [ $? -eq 0 ]; then
        INSTALLED=true
    else
        echo -e "${RED}  [ERROR] pip install failed.${NC}"
        echo -e "${YELLOW}     Try running: pip install $WHL_URL${NC}"
    fi
fi
if [ "$INSTALLED" = false ]; then
    exit 1
fi

# Inject Agent Framework into pipx venv
if [ "$USED_PIPX" = true ] && [ "$AF_INSTALLED" = true ]; then
    echo -e "${GRAY}  Injecting Agent Framework into pipx environment...${NC}"
    pipx inject copilot-console agent-framework --pip-args="--pre" &> /dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  [OK] Agent Framework injected into pipx venv${NC}"
    else
        echo -e "${YELLOW}  [WARN] pipx inject failed. Run manually: pipx inject copilot-console agent-framework --pip-args='--pre'${NC}"
    fi
fi

# --- Verify ---
# Ensure pip --user bin dir is in PATH
PATH_MODIFIED=false
SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
fi

# Linux: ~/.local/bin
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    export PATH="$PATH:$HOME/.local/bin"
    if [ -n "$SHELL_RC" ] && ! grep -q '\.local/bin' "$SHELL_RC" 2>/dev/null; then
        echo 'export PATH="$PATH:$HOME/.local/bin"' >> "$SHELL_RC"
        echo -e "${GREEN}  [OK] Added ~/.local/bin to PATH in $(basename $SHELL_RC)${NC}"
        PATH_MODIFIED=true
    fi
fi

# macOS: ~/Library/Python/X.Y/bin
if [[ "$OSTYPE" == "darwin"* ]]; then
    MAC_PY_BIN="$HOME/Library/Python/$PY_MAJOR.$PY_MINOR/bin"
    if [ -d "$MAC_PY_BIN" ] && [[ ":$PATH:" != *":$MAC_PY_BIN:"* ]]; then
        export PATH="$PATH:$MAC_PY_BIN"
        if [ -n "$SHELL_RC" ] && ! grep -q 'Library/Python' "$SHELL_RC" 2>/dev/null; then
            echo "export PATH=\"\$PATH:$MAC_PY_BIN\"" >> "$SHELL_RC"
            echo -e "${GREEN}  [OK] Added $MAC_PY_BIN to PATH in $(basename $SHELL_RC)${NC}"
            PATH_MODIFIED=true
        fi
    fi
fi

if command -v copilot-console &> /dev/null; then
    AC_VERSION=$(copilot-console --version 2>&1)
    echo -e "${GREEN}  [OK] $AC_VERSION${NC}"
else
    echo -e "${GREEN}  [OK] Installed${NC}"
    echo -e "${YELLOW}  [NOTE] Restart your terminal, then run 'copilot-console'.${NC}"
fi

# --- Install ripgrep (for cross-session search) ---
if ! command -v rg &> /dev/null; then
    echo ""
    echo -e "${YELLOW}  Installing ripgrep (for cross-session search)...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install ripgrep &> /dev/null
            if command -v rg &> /dev/null; then
                echo -e "${GREEN}  [OK] ripgrep installed${NC}"
            else
                echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
                echo -e "${YELLOW}     Install manually: brew install ripgrep${NC}"
            fi
        else
            echo -e "${YELLOW}  [WARN] Homebrew not found. Install ripgrep manually: brew install ripgrep${NC}"
        fi
    else
        # Linux
        if command -v apt-get &> /dev/null; then
            echo -e "${GRAY}  (may require sudo password)${NC}"
            sudo apt-get update &> /dev/null && sudo apt-get install -y ripgrep &> /dev/null
            if command -v rg &> /dev/null; then
                echo -e "${GREEN}  [OK] ripgrep installed${NC}"
            else
                echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
                echo -e "${YELLOW}     Install manually: sudo apt-get install ripgrep${NC}"
            fi
        else
            echo -e "${YELLOW}  [WARN] apt-get not found. Install ripgrep manually for your distribution.${NC}"
        fi
    fi
else
    RG_VERSION=$(rg --version 2>&1 | head -n1)
    echo -e "${GREEN}  [OK] $RG_VERSION${NC}"
fi

# --- Optional: Agentic Web Browsing (Playwright MCP) ---
echo ""
echo -e "${CYAN}  Optional: Agentic Web Browsing${NC}"
echo -e "${GRAY}  Adds autonomous web navigation via Playwright MCP server.${NC}"
echo -e "${GRAY}  Uses your system browser (Edge or Chrome).${NC}"
echo ""
read -p "  Enable agentic web browsing? (y/N) " SETUP_PLAYWRIGHT < /dev/tty
if [[ "$SETUP_PLAYWRIGHT" =~ ^[Yy]$ ]]; then
    MCP_CONFIG_PATH="$HOME/.copilot-console/mcp-config.json"
    ADD_PLAYWRIGHT=true
    if [ -f "$MCP_CONFIG_PATH" ]; then
        if grep -q '"playwright"' "$MCP_CONFIG_PATH" 2>/dev/null; then
            echo -e "${GREEN}  [OK] Playwright MCP server already configured${NC}"
            ADD_PLAYWRIGHT=false
        fi
    fi
    if [ "$ADD_PLAYWRIGHT" = true ]; then
        mkdir -p "$(dirname "$MCP_CONFIG_PATH")"
        if [ -f "$MCP_CONFIG_PATH" ]; then
            # Update existing config (basic jq-free approach)
            TEMP_CONFIG=$(mktemp)
            python3 -c "
import json, sys
with open('$MCP_CONFIG_PATH', 'r') as f:
    config = json.load(f)
if 'mcpServers' not in config:
    config['mcpServers'] = {}
config['mcpServers']['playwright'] = {
    'type': 'local',
    'command': 'npx',
    'tools': ['*'],
    'args': ['@playwright/mcp@latest']
}
with open('$TEMP_CONFIG', 'w') as f:
    json.dump(config, f, indent=2)
" 2>/dev/null && mv "$TEMP_CONFIG" "$MCP_CONFIG_PATH"
        else
            # Create new config
            cat > "$MCP_CONFIG_PATH" << 'EOF'
{
  "mcpServers": {
    "playwright": {
      "type": "local",
      "command": "npx",
      "tools": ["*"],
      "args": ["@playwright/mcp@latest"]
    }
  }
}
EOF
        fi
        echo -e "${GREEN}  [OK] Playwright MCP server added to config${NC}"
    fi
else
    echo -e "${GRAY}  Skipped. Enable later — see docs/guides/INSTALL.md${NC}"
fi

# --- Optional: Mobile Access & CLI Notifications ---
MOBILE_ENABLED=false
echo ""
echo -e "${CYAN}  Optional: Mobile Access & CLI Notifications${NC}"
echo -e "${GRAY}  Access sessions from your phone, get push notifications when${NC}"
echo -e "${GRAY}  any Copilot CLI session finishes. Requires devtunnel.${NC}"
echo ""
read -p "  Enable mobile access & notifications? (y/N) " SETUP_MOBILE < /dev/tty
if [[ "$SETUP_MOBILE" =~ ^[Yy]$ ]]; then
    # Enable CLI notifications
    if command -v cli-notify &> /dev/null; then
        cli-notify on &> /dev/null
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}  [OK] CLI notifications enabled${NC}"
        else
            echo -e "${YELLOW}  [WARN] Failed to enable. Run 'cli-notify on' manually.${NC}"
        fi
    else
        echo -e "${YELLOW}  [WARN] cli-notify not found. Restart terminal and run 'cli-notify on'.${NC}"
    fi

    # Install devtunnel
    if ! command -v devtunnel &> /dev/null; then
        echo -e "${YELLOW}  Installing devtunnel...${NC}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            if command -v brew &> /dev/null; then
                brew install --cask devtunnel &> /dev/null
                if command -v devtunnel &> /dev/null; then
                    echo -e "${GREEN}  [OK] devtunnel installed${NC}"
                else
                    echo -e "${YELLOW}  Installing devtunnel via npm...${NC}"
                    npm install -g @msdtunnel/devtunnel-cli &> /dev/null
                fi
            else
                npm install -g @msdtunnel/devtunnel-cli &> /dev/null
            fi
        else
            # Linux — use official Microsoft installer (downloads binary directly)
            curl -sL https://aka.ms/DevTunnelCliInstall 2>/dev/null | bash &> /dev/null || true
            # The installer may place devtunnel in ~/bin or ~/.local/bin — ensure they're in PATH
            for p in "$HOME/bin" "$HOME/.local/bin"; do
                if [ -f "$p/devtunnel" ] && [[ ":$PATH:" != *":$p:"* ]]; then
                    export PATH="$PATH:$p"
                fi
            done
        fi
        if ! command -v devtunnel &> /dev/null; then
            echo -e "${RED}  [ERROR] Failed to install devtunnel.${NC}"
            echo -e "${YELLOW}     Install manually: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started${NC}"
        fi
    fi
    if command -v devtunnel &> /dev/null; then
        echo -e "${GREEN}  [OK] devtunnel installed${NC}"
        MOBILE_ENABLED=true
        echo -e "${YELLOW}  [NOTE] Run 'devtunnel user login' to authenticate before first use.${NC}"
        echo -e "${GRAY}  TIP: Use a work or school (Entra ID) account for best iOS/Safari support.${NC}"
    fi
else
    echo -e "${GRAY}  Skipped. Enable later with 'cli-notify on' or see docs/guides/MOBILE-COMPANION.md${NC}"
fi

# --- Done ---
echo ""
if [ "$MOBILE_ENABLED" = true ]; then
    echo -e "${CYAN}  Ready! Complete mobile setup:${NC}"
    echo ""
    echo -e "    1. Run:  devtunnel user login"
    echo -e "    2. Run:  copilot-console --expose --no-sleep"
    echo -e "    3. Open Settings -> scan QR code on your phone"
    echo -e "    4. Install as PWA when prompted"
    echo -e "    5. Allow notifications when the browser asks"
    echo ""
    echo -e "${GRAY}  After this, CLI notifications work automatically.${NC}"
else
    echo -e "${CYAN}  Ready! Run 'copilot-console' to start.${NC}"
    if [ "$PATH_MODIFIED" = true ]; then
        echo -e "${YELLOW}  [NOTE] If 'copilot-console' is not found, open a new terminal first.${NC}"
    fi
fi
echo ""
