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
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}     Install:  brew install python${NC}"
        if ! command -v brew &> /dev/null; then
            echo -e "${GRAY}     (Homebrew: https://brew.sh)${NC}"
        fi
    else
        echo -e "${YELLOW}     Install:  sudo apt install python3   # Debian/Ubuntu${NC}"
        echo -e "${YELLOW}               sudo dnf install python3   # Fedora/RHEL${NC}"
    fi
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
    exit 1
fi
PY_VERSION=$(python3 --version 2>&1 | sed 's/Python //')
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 11 ]; }; then
    echo -e "${RED}  [ERROR] Python 3.11+ required (found $PY_VERSION)${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}     Install:  brew install python${NC}"
        if ! command -v brew &> /dev/null; then
            echo -e "${GRAY}     (Homebrew: https://brew.sh)${NC}"
        fi
    else
        echo -e "${YELLOW}     Install:  sudo apt install python3   # Debian/Ubuntu${NC}"
        echo -e "${YELLOW}               sudo dnf install python3   # Fedora/RHEL${NC}"
    fi
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
    exit 1
fi
echo -e "${GREEN}  [OK] Python $PY_VERSION${NC}"

# --- Check Node.js ---
if ! command -v node &> /dev/null; then
    echo -e "${RED}  [ERROR] Node.js not found.${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}     Install:  brew install node${NC}"
        if ! command -v brew &> /dev/null; then
            echo -e "${GRAY}     (Homebrew: https://brew.sh)${NC}"
        fi
    else
        echo -e "${YELLOW}     Install:  sudo apt install nodejs npm   # Debian/Ubuntu${NC}"
        echo -e "${YELLOW}               sudo dnf install nodejs npm   # Fedora/RHEL${NC}"
    fi
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
    exit 1
fi
NODE_VERSION=$(node --version 2>&1 | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED}  [ERROR] Node.js 18+ required (found $NODE_VERSION)${NC}"
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
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
        echo -e "${YELLOW}     Then re-run:${NC}"
        echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
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
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
    exit 1
fi
TAG_NAME=$(echo "$RELEASE_INFO" | grep -o '"tag_name":\s*"[^"]*"' | head -n1 | cut -d'"' -f4)
echo -e "${GREEN}  [OK] Found $TAG_NAME${NC}"

echo ""
echo -e "${YELLOW}  ┌─────────────────────────────────────────────────────┐${NC}"
echo -e "${YELLOW}  │  ⏳ This may take 5-8 minutes — please wait...     │${NC}"
echo -e "${YELLOW}  └─────────────────────────────────────────────────────┘${NC}"
echo ""

# --- Ensure pip is available (Ubuntu/Debian often ship without it) ---
if ! python3 -m pip --version &> /dev/null; then
    echo -e "${YELLOW}  pip not found — installing python3-pip...${NC}"
    if command -v apt-get &> /dev/null; then
        if command -v sudo &> /dev/null; then
            sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
        else
            echo -e "${YELLOW}  [WARN] sudo not available. Install manually: apt install python3-pip${NC}"
        fi
    elif command -v dnf &> /dev/null; then
        if command -v sudo &> /dev/null; then
            sudo dnf install -y python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
        else
            echo -e "${YELLOW}  [WARN] sudo not available. Install manually: dnf install python3-pip${NC}"
        fi
    elif command -v yum &> /dev/null; then
        if command -v sudo &> /dev/null; then
            sudo yum install -y python3-pip 2>&1 | tail -n1 | sed 's/^/  /'
        else
            echo -e "${YELLOW}  [WARN] sudo not available. Install manually: yum install python3-pip${NC}"
        fi
    fi
    if ! python3 -m pip --version &> /dev/null; then
        echo -e "${RED}  [ERROR] Could not install pip. Install manually: sudo apt install python3-pip${NC}"
        echo -e "${YELLOW}     Then re-run:${NC}"
        echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
        exit 1
    fi
    echo -e "${GREEN}  [OK] pip installed${NC}"
fi

PIP_USER_FLAG="--user"
PIP_BREAK_FLAG=""
# On systems with externally-managed Python, use --break-system-packages
if python3 -m pip install --help 2>&1 | grep -q 'break-system-packages'; then
    PIP_BREAK_FLAG="--break-system-packages"
fi

INSTALLED=false
USED_PIPX=false
if command -v pipx &> /dev/null; then
    PIPX_OUTPUT=$(pipx install --force "$WHL_URL" 2>&1)
    PIPX_EXIT=$?
    if [ $PIPX_EXIT -eq 0 ]; then
        echo "$PIPX_OUTPUT" | grep -vE 'symlink|These apps' | grep -v '^$' | sed 's/^/  /' | sed "s/.*/  ${GRAY}&${NC}/"
        INSTALLED=true
        USED_PIPX=true
    else
        echo -e "${YELLOW}  [WARN] pipx install failed, using pip instead...${NC}"
    fi
else
    echo -e "${YELLOW}  [WARN] pipx not found, using pip instead.${NC}"
fi
if [ "$INSTALLED" = false ]; then
    PIP_OUTPUT=$(python3 -m pip install $PIP_USER_FLAG $PIP_BREAK_FLAG --no-cache-dir --force-reinstall "$WHL_URL" 2>&1)
    PIP_EXIT=$?
    if [ $PIP_EXIT -eq 0 ]; then
        echo "$PIP_OUTPUT" | grep -E 'Downloading.*copilot|Installing collected' | sed 's/^/  /' | sed "s/.*/  ${GRAY}&${NC}/"
        INSTALLED=true
    else
        echo -e "${RED}  [ERROR] pip install failed.${NC}"
        echo -e "${YELLOW}     Try running: python3 -m pip install \"$WHL_URL\"${NC}"
    fi
fi
if [ "$INSTALLED" = false ]; then
    echo -e "${YELLOW}     Then re-run:${NC}"
    echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
    exit 1
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

# If no SHELL_RC found, check .bash_profile (macOS default for bash) and .profile
if [ -z "$SHELL_RC" ]; then
    if [ -f "$HOME/.bash_profile" ]; then
        SHELL_RC="$HOME/.bash_profile"
    elif [ -f "$HOME/.profile" ]; then
        SHELL_RC="$HOME/.profile"
    fi
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

# Fish shell support
FISH_CONFIG="$HOME/.config/fish/config.fish"
if [ -f "$FISH_CONFIG" ]; then
    # For ~/.local/bin
    if [ -d "$HOME/.local/bin" ] && ! grep -q '.local/bin' "$FISH_CONFIG" 2>/dev/null; then
        echo 'set -gx PATH $PATH $HOME/.local/bin' >> "$FISH_CONFIG"
        echo -e "${GREEN}  [OK] Added ~/.local/bin to PATH in config.fish${NC}"
        PATH_MODIFIED=true
    fi
    # For macOS pip bin
    if [[ "$OSTYPE" == "darwin"* ]] && [ -d "$MAC_PY_BIN" ] && ! grep -q 'Library/Python' "$FISH_CONFIG" 2>/dev/null; then
        echo "set -gx PATH \$PATH $MAC_PY_BIN" >> "$FISH_CONFIG"
        echo -e "${GREEN}  [OK] Added $MAC_PY_BIN to PATH in config.fish${NC}"
        PATH_MODIFIED=true
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
        # macOS: try brew, fallback to binary download
        if command -v brew &> /dev/null; then
            brew install ripgrep &> /dev/null
        fi
        if ! command -v rg &> /dev/null; then
            # Fallback: download binary from GitHub releases
            RG_VERSION="14.1.1"
            ARCH=$(uname -m)
            if [ "$ARCH" = "arm64" ]; then
                RG_TARGET="aarch64-apple-darwin"
            else
                RG_TARGET="x86_64-apple-darwin"
            fi
            RG_URL="https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${RG_TARGET}.tar.gz"
            RG_TMP=$(mktemp -d)
            echo -e "${GRAY}  Downloading ripgrep v${RG_VERSION} binary...${NC}"
            if curl -fsSL "$RG_URL" | tar xz -C "$RG_TMP" 2>/dev/null; then
                mkdir -p "$HOME/.local/bin"
                cp "$RG_TMP/ripgrep-${RG_VERSION}-${RG_TARGET}/rg" "$HOME/.local/bin/rg"
                chmod +x "$HOME/.local/bin/rg"
                export PATH="$HOME/.local/bin:$PATH"
                # Persist in shell profile if not already there
                for profile in "$HOME/.zshrc" "$HOME/.bashrc"; do
                    if [ -f "$profile" ] && ! grep -q '\.local/bin' "$profile" 2>/dev/null; then
                        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$profile"
                    fi
                done
            fi
            rm -rf "$RG_TMP"
        fi
        if command -v rg &> /dev/null; then
            echo -e "${GREEN}  [OK] ripgrep installed${NC}"
        else
            echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
            echo -e "${YELLOW}     Install manually: brew install ripgrep${NC}"
        fi
    else
        # Linux
        if command -v apt-get &> /dev/null; then
            echo -e "${GRAY}  (may require sudo password)${NC}"
            if command -v sudo &> /dev/null; then
                sudo apt-get update &> /dev/null && sudo apt-get install -y ripgrep &> /dev/null
            else
                echo -e "${YELLOW}  [WARN] sudo not available. Install manually: apt install ripgrep${NC}"
            fi
            if command -v rg &> /dev/null; then
                echo -e "${GREEN}  [OK] ripgrep installed${NC}"
            else
                echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
                echo -e "${YELLOW}     Install manually: sudo apt-get install ripgrep${NC}"
            fi
        elif command -v dnf &> /dev/null; then
            echo -e "${GRAY}  (may require sudo password)${NC}"
            if command -v sudo &> /dev/null; then
                sudo dnf install -y ripgrep &> /dev/null
            else
                echo -e "${YELLOW}  [WARN] sudo not available. Install manually: dnf install ripgrep${NC}"
            fi
            if command -v rg &> /dev/null; then
                echo -e "${GREEN}  [OK] ripgrep installed${NC}"
            else
                echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
                echo -e "${YELLOW}     Install manually: sudo dnf install ripgrep${NC}"
            fi
        elif command -v yum &> /dev/null; then
            echo -e "${GRAY}  (may require sudo password)${NC}"
            if command -v sudo &> /dev/null; then
                sudo yum install -y ripgrep &> /dev/null
            else
                echo -e "${YELLOW}  [WARN] sudo not available. Install manually: yum install ripgrep${NC}"
            fi
            if command -v rg &> /dev/null; then
                echo -e "${GREEN}  [OK] ripgrep installed${NC}"
            else
                echo -e "${YELLOW}  [WARN] ripgrep install failed. Cross-session content search will not work.${NC}"
                echo -e "${YELLOW}     Install manually: sudo yum install ripgrep${NC}"
            fi
        else
            echo -e "${YELLOW}  [WARN] No supported package manager found. Install ripgrep manually for your distribution.${NC}"
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
if [ -t 0 ] || [ -e /dev/tty ]; then
    read -p "  Enable agentic web browsing? (Y/n) " SETUP_PLAYWRIGHT < /dev/tty
else
    SETUP_PLAYWRIGHT="Y"
fi
if [[ ! "$SETUP_PLAYWRIGHT" =~ ^[Nn]$ ]]; then
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
if [ -t 0 ] || [ -e /dev/tty ]; then
    read -p "  Enable mobile access & notifications? (Y/n) " SETUP_MOBILE < /dev/tty
else
    SETUP_MOBILE="Y"
fi
if [[ ! "$SETUP_MOBILE" =~ ^[Nn]$ ]]; then
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
            # macOS — try brew first, then direct binary download
            if command -v brew &> /dev/null; then
                brew install --cask devtunnel &> /dev/null
            fi
            if ! command -v devtunnel &> /dev/null; then
                # Download standalone binary
                local dt_dir="$HOME/.local/bin"
                mkdir -p "$dt_dir"
                local arch=$(uname -m)
                local dt_url="https://aka.ms/TunnelsCliDownload/osx-x64"
                if [[ "$arch" == "arm64" ]]; then
                    dt_url="https://aka.ms/TunnelsCliDownload/osx-arm64"
                fi
                echo -e "${YELLOW}  Downloading devtunnel binary...${NC}"
                curl -sL "$dt_url" -o "$dt_dir/devtunnel" && chmod +x "$dt_dir/devtunnel"
                if [[ ":$PATH:" != *":$dt_dir:"* ]]; then
                    export PATH="$PATH:$dt_dir"
                fi
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
            echo -e "${YELLOW}     Then re-run:${NC}"
            echo -e "${CYAN}     curl -fsSL https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.sh | bash${NC}"
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
