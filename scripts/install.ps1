# Copilot Console - One-click installer for Windows
# Usage: irm https://raw.githubusercontent.com/sanchar10/copilot-agent-console/main/scripts/install.ps1 | iex

$REPO = "sanchar10/copilot-agent-console"

Write-Host ""
Write-Host "  Copilot Console Installer" -ForegroundColor Cyan
Write-Host "  ====================================" -ForegroundColor DarkGray
Write-Host ""

# --- Check Python ---
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "  [ERROR] Python not found." -ForegroundColor Red
    Write-Host "     Install from https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "     Make sure to check 'Add Python to PATH' during install." -ForegroundColor Yellow
    exit 1
}
$pyVer = (python --version 2>&1) -replace 'Python\s*', ''
$pyMajor, $pyMinor = $pyVer.Split('.')[0..1] | ForEach-Object { [int]$_ }
if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 11)) {
    Write-Host "  [ERROR] Python 3.11+ required (found $pyVer)" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Python $pyVer" -ForegroundColor Green

# --- Check Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  [ERROR] Node.js not found." -ForegroundColor Red
    Write-Host "     Install from https://nodejs.org/ (LTS recommended)" -ForegroundColor Yellow
    exit 1
}
$nodeVer = (node --version 2>&1) -replace 'v', ''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Host "  [ERROR] Node.js 18+ required (found $nodeVer)" -ForegroundColor Red
    exit 1
}
Write-Host "  [OK] Node.js $nodeVer" -ForegroundColor Green

# --- Check/Install Copilot CLI ---
$copilot = Get-Command copilot -ErrorAction SilentlyContinue
if (-not $copilot) {
    Write-Host "  Installing GitHub Copilot CLI..." -ForegroundColor Yellow
    npm install -g @github/copilot 2>&1 | Out-Null
    $copilot = Get-Command copilot -ErrorAction SilentlyContinue
    if (-not $copilot) {
        Write-Host "  [ERROR] Failed to install Copilot CLI" -ForegroundColor Red
        exit 1
    }
}
$copilotVer = ((copilot --version 2>&1) | Select-Object -First 1) -replace '.*?(\d+\.\d+\.\d+[-\d]*).*', '$1'
Write-Host "  [OK] Copilot CLI $copilotVer" -ForegroundColor Green

# --- Check Copilot auth ---
Write-Host ""
$copilotConfig = "$env:USERPROFILE\.copilot\config.json"
$needsLogin = $true
if (Test-Path $copilotConfig) {
    try {
        $config = Get-Content $copilotConfig -Raw | ConvertFrom-Json
        if ($config.logged_in_users -and $config.logged_in_users.Count -gt 0) {
            $needsLogin = $false
            Write-Host "  [OK] Copilot authenticated ($($config.logged_in_users[0].login))" -ForegroundColor Green
        }
    } catch { }
}
if ($needsLogin) {
    Write-Host "  Copilot login required. Opening browser..." -ForegroundColor Yellow
    copilot login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] Copilot login failed. Run 'copilot login' manually." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Copilot authenticated" -ForegroundColor Green
}

# --- Install Copilot Console ---
Write-Host ""
Write-Host "  Installing Copilot Console..." -ForegroundColor Yellow
Write-Host ""

# Resolve latest wheel URL from GitHub releases
Write-Host "  Fetching latest release..." -ForegroundColor DarkGray
try {
    $releaseInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -Headers @{ "User-Agent" = "copilot-console-installer" }
    $WHL_URL = ($releaseInfo.assets | Where-Object { $_.name -like "*.whl" } | Select-Object -First 1).browser_download_url
    if (-not $WHL_URL) {
        Write-Host "  [ERROR] No .whl found in latest release." -ForegroundColor Red
        Write-Host "     Check https://github.com/$REPO/releases" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  [OK] Found $($releaseInfo.tag_name)" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Failed to fetch latest release from GitHub." -ForegroundColor Red
    Write-Host "     Check https://github.com/$REPO/releases for manual download." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────────────┐" -ForegroundColor Yellow
Write-Host "  │  ⏳ This may take 3-5 minutes — please wait...     │" -ForegroundColor Yellow
Write-Host "  └─────────────────────────────────────────────────────┘" -ForegroundColor Yellow
Write-Host ""

# Install Agent Framework (pre-release) — required for workflow orchestration
# Installed separately because AF is pre-release and needs --pre flag.
# For pipx installs, it gets injected into the venv after console install.
Write-Host "  Installing Microsoft Agent Framework (pre-release)..." -ForegroundColor DarkGray
$afInstalled = $false
pip install --user --quiet agent-framework --pre 2>&1 | ForEach-Object {
    $line = $_.ToString()
    if ($line -match 'ERROR|error') { Write-Host "  $line" -ForegroundColor Red }
}
if ($LASTEXITCODE -eq 0) {
    $afInstalled = $true
    Write-Host "  [OK] Agent Framework installed" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Agent Framework install failed. Workflows may not work." -ForegroundColor Yellow
    Write-Host "     Try manually: pip install agent-framework --pre" -ForegroundColor Yellow
}

$installed = $false
$usedPipx = $false
$pipx = Get-Command pipx -ErrorAction SilentlyContinue
if ($pipx) {
    pipx install --force $WHL_URL 2>&1 | ForEach-Object {
        $line = $_.ToString().Trim()
        if ($line -ne '' -and $line -notmatch 'symlink|These apps') {
            Write-Host "  $line" -ForegroundColor DarkGray
        }
    }
    if ($LASTEXITCODE -eq 0) {
        $installed = $true
        $usedPipx = $true
    } else {
        Write-Host "  [WARN] pipx install failed, using pip instead..." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] pipx not found, using pip instead." -ForegroundColor Yellow
}
if (-not $installed) {
    pip install --user --no-cache-dir --ignore-installed $WHL_URL 2>&1 | ForEach-Object {
        $line = $_.ToString()
        if ($line -match 'Downloading.*copilot.agent.console|Installing collected') {
            Write-Host "  $line" -ForegroundColor DarkGray
        }
    }
    if ($LASTEXITCODE -eq 0) {
        $installed = $true
    } else {
        Write-Host "  [ERROR] pip install failed (exit code $LASTEXITCODE)." -ForegroundColor Red
        Write-Host "     Try running as Administrator:" -ForegroundColor Yellow
        Write-Host "     pip install $WHL_URL" -ForegroundColor Yellow
    }
}
if (-not $installed) {
    exit 1
}

# Inject Agent Framework into pipx venv (pipx uses isolated environments)
if ($usedPipx -and $afInstalled) {
    Write-Host "  Injecting Agent Framework into pipx environment..." -ForegroundColor DarkGray
    pipx inject copilot-console agent-framework --pip-args="--pre" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [OK] Agent Framework injected into pipx venv" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] pipx inject failed. Run manually: pipx inject copilot-console agent-framework --pip-args='--pre'" -ForegroundColor Yellow
    }
}

# --- Verify ---
# Refresh PATH to pick up newly installed commands (pipx or pip)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$ac = Get-Command copilot-console -ErrorAction SilentlyContinue
if (-not $ac) {
    # pip --user installs to user Scripts dir - find and add to PATH
    $userScripts = $null
    try {
        $userScripts = (python -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))" 2>&1).Trim()
    } catch { }
    # Fallback: check common location
    if (-not $userScripts -or -not (Test-Path $userScripts)) {
        $pyVer = (python -c "import sys; print(f'Python{sys.version_info.major}{sys.version_info.minor}')" 2>&1).Trim()
        $userScripts = "$env:APPDATA\Python\$pyVer\Scripts"
    }
    if (Test-Path "$userScripts\copilot-console.exe") {
        $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($currentPath -notlike "*$userScripts*") {
            [Environment]::SetEnvironmentVariable('Path', "$currentPath;$userScripts", 'User')
            Write-Host "  [OK] Added to PATH: $userScripts" -ForegroundColor Green
            Write-Host "  [NOTE] Restart your terminal for PATH to take effect." -ForegroundColor Yellow
        }
        $env:Path = "$env:Path;$userScripts"
        $ac = Get-Command copilot-console -ErrorAction SilentlyContinue
    }
}
if ($ac) {
    $acVer = (copilot-console --version 2>&1)
    Write-Host "  [OK] $acVer" -ForegroundColor Green
} else {
    Write-Host "  [OK] Installed" -ForegroundColor Green
    Write-Host "  [NOTE] Restart your terminal, then run 'copilot-console'." -ForegroundColor Yellow
}

# --- Install ripgrep (for cross-session search) ---
$rg = Get-Command rg -ErrorAction SilentlyContinue
if (-not $rg) {
    Write-Host ""
    Write-Host "  Installing ripgrep (for cross-session search)..." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install BurntSushi.ripgrep.MSVC --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $rg = Get-Command rg -ErrorAction SilentlyContinue
    }
    if (-not $rg) {
        Write-Host "  [WARN] ripgrep install failed. Cross-session content search will not work." -ForegroundColor Yellow
        Write-Host "     Install manually: winget install BurntSushi.ripgrep.MSVC" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] ripgrep installed" -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] ripgrep $(rg --version | Select-Object -First 1)" -ForegroundColor Green
}

# --- Optional: CLI Session Notifications ---
Write-Host ""
Write-Host "  Optional: CLI Session Notifications" -ForegroundColor Cyan
Write-Host "  Get notified on your phone when any Copilot CLI terminal session finishes." -ForegroundColor DarkGray
Write-Host "  Can also be enabled later in Console Settings or via 'cli-notify on'." -ForegroundColor DarkGray
Write-Host ""
$setupNotify = Read-Host "  Enable CLI session notifications? (y/N)"
if ($setupNotify -eq 'y' -or $setupNotify -eq 'Y') {
    $cliNotify = Get-Command cli-notify -ErrorAction SilentlyContinue
    if ($cliNotify) {
        cli-notify on 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] CLI notifications enabled" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] Failed to enable. Run 'cli-notify on' manually." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [WARN] cli-notify not found. Restart terminal and run 'cli-notify on'." -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipped. Enable later in Console Settings or run 'cli-notify on'." -ForegroundColor DarkGray
}

# --- Optional: Agentic Web Browsing (Playwright MCP) ---
Write-Host ""
Write-Host "  Optional: Agentic Web Browsing" -ForegroundColor Cyan
Write-Host "  Adds autonomous web navigation via Playwright MCP server." -ForegroundColor DarkGray
Write-Host "  Uses your system browser (Edge or Chrome)." -ForegroundColor DarkGray
Write-Host ""
$setupPlaywright = Read-Host "  Enable agentic web browsing? (y/N)"
if ($setupPlaywright -eq 'y' -or $setupPlaywright -eq 'Y') {
    # Add Playwright MCP server to mcp-config.json (uses system browser, no extra install needed)
    $mcpConfigPath = "$env:USERPROFILE\.copilot-console\mcp-config.json"
    $addPlaywright = $true
    if (Test-Path $mcpConfigPath) {
        try {
            $existingConfig = Get-Content $mcpConfigPath -Raw | ConvertFrom-Json
            if ($existingConfig.mcpServers.PSObject.Properties.Name -contains 'playwright') {
                Write-Host "  [OK] Playwright MCP server already configured" -ForegroundColor Green
                $addPlaywright = $false
            }
        } catch { }
    }
    if ($addPlaywright) {
        # Ensure directory exists
        $mcpDir = Split-Path $mcpConfigPath
        if (-not (Test-Path $mcpDir)) { New-Item -ItemType Directory -Path $mcpDir -Force | Out-Null }

        if (Test-Path $mcpConfigPath) {
            try {
                $config = Get-Content $mcpConfigPath -Raw | ConvertFrom-Json
                $playwrightServer = @{
                    type = "local"
                    command = "npx"
                    tools = @("*")
                    args = @("@playwright/mcp@latest")
                }
                $config.mcpServers | Add-Member -MemberType NoteProperty -Name "playwright" -Value $playwrightServer
                $config | ConvertTo-Json -Depth 5 | Set-Content $mcpConfigPath -Encoding UTF8
            } catch {
                Write-Host "  [WARN] Failed to update mcp-config.json. Add playwright server manually." -ForegroundColor Yellow
            }
        } else {
            $newConfig = @{
                mcpServers = @{
                    playwright = @{
                        type = "local"
                        command = "npx"
                        tools = @("*")
                        args = @("@playwright/mcp@latest")
                    }
                }
            }
            $newConfig | ConvertTo-Json -Depth 5 | Set-Content $mcpConfigPath -Encoding UTF8
        }
        Write-Host "  [OK] Playwright MCP server added to config" -ForegroundColor Green
    }
} else {
    Write-Host "  Skipped. Enable later — see docs/guides/INSTALL.md" -ForegroundColor DarkGray
}

# --- Optional: Mobile Companion (devtunnel) ---
Write-Host ""
Write-Host "  Optional: Mobile Companion" -ForegroundColor Cyan
Write-Host "  Access Copilot Console from your phone via secure tunnel." -ForegroundColor DarkGray
Write-Host ""
$setupMobile = Read-Host "  Enable Mobile Companion? Requires devtunnel (y/N)"
if ($setupMobile -eq 'y' -or $setupMobile -eq 'Y') {
    $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
    if (-not $devtunnel) {
        Write-Host "  Installing devtunnel..." -ForegroundColor Yellow
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Null
            # Refresh PATH for current session
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
        }
        if (-not $devtunnel) {
            Write-Host "  Installing devtunnel via npm..." -ForegroundColor Yellow
            npm install -g @msdtunnel/devtunnel-cli 2>&1 | Out-Null
            $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
        }
        if (-not $devtunnel) {
            Write-Host "  [ERROR] Failed to install devtunnel." -ForegroundColor Red
            Write-Host "     Install manually: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started" -ForegroundColor Yellow
        }
    }
    if ($devtunnel) {
        Write-Host "  [OK] devtunnel installed" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Signing in to devtunnel..." -ForegroundColor Yellow
        Write-Host "  TIP: Use a work or school (Entra ID) account for best iOS/Safari support." -ForegroundColor DarkGray
        Write-Host "  If you only have a personal account, use --allow-anonymous mode instead." -ForegroundColor DarkGray
        devtunnel user login
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] devtunnel authenticated" -ForegroundColor Green
        } else {
            Write-Host "  [WARN] devtunnel login failed. Run 'devtunnel user login' manually." -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "  Mobile Companion ready! Start with:" -ForegroundColor Green
        Write-Host "     copilot-console --expose                   # Work/school account" -ForegroundColor Cyan
        Write-Host "     copilot-console --expose --allow-anonymous  # Personal account" -ForegroundColor Cyan
        Write-Host "  Then open Settings in the UI and scan the QR code from your phone." -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Skipped. You can set up later:" -ForegroundColor DarkGray
    Write-Host "     winget install Microsoft.devtunnel" -ForegroundColor DarkGray
    Write-Host "     devtunnel user login" -ForegroundColor DarkGray
    Write-Host "     copilot-console --expose" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Ready! Run 'copilot-console' to start." -ForegroundColor Cyan
Write-Host ""
