# Copilot Console - One-click installer for Windows
# Usage: irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex

$REPO = "sanchar10/copilot-console"

# Allow .ps1 wrappers (npm.ps1, pip.ps1, etc.) to run in this process only
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

Write-Host ""
Write-Host "  Copilot Console Installer" -ForegroundColor Cyan
Write-Host "  ====================================" -ForegroundColor DarkGray
Write-Host ""

# Refresh PATH from registry (picks up recent installs without terminal restart)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# --- Check Python ---
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    $pyVerOutput = (python --version 2>&1) | Out-String
    if ($pyVerOutput -notmatch 'Python \d+\.\d+') {
        # Windows Store stub or broken install — treat as not found
        $python = $null
    }
}
if (-not $python) {
    # Auto-detect Python from known install locations
    $pyExe = $null
    $searchPaths = @(
        "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
        "C:\Python3*\python.exe"
    )
    foreach ($pattern in $searchPaths) {
        $found = Get-Item $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $pyExe = $found.FullName; break }
    }
    if ($pyExe) {
        $pyDir = Split-Path $pyExe
        $env:Path = "$pyDir;$env:Path"
        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentUserPath -notlike "*$pyDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$currentUserPath;$pyDir", "User")
            Write-Host "  [OK] Added Python to PATH: $pyDir" -ForegroundColor Green
        }
        $python = Get-Command python -ErrorAction SilentlyContinue
    }
}
if (-not $python) {
    Write-Host "  [ERROR] Python not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "  ┌─ What to do: ─────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  1. Install Python 3.11+ from https://www.python.org/downloads/           │" -ForegroundColor Yellow
    Write-Host "  │  2. Re-run:                                                                │" -ForegroundColor Yellow
    Write-Host "  │     irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" -ForegroundColor Yellow
    Write-Host "  └────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
    exit 1
}
$pyVer = (python --version 2>&1) -replace 'Python\s*', ''
$pyMajor, $pyMinor = $pyVer.Split('.')[0..1] | ForEach-Object { [int]$_ }
if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 11)) {
    Write-Host "  [ERROR] Python 3.11+ required (found $pyVer)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ┌─ What to do: ─────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  1. Install Python 3.11+ from https://www.python.org/downloads/           │" -ForegroundColor Yellow
    Write-Host "  │  2. Re-run:                                                                │" -ForegroundColor Yellow
    Write-Host "  │     irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" -ForegroundColor Yellow
    Write-Host "  └────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
    exit 1
}
Write-Host "  [OK] Python $pyVer" -ForegroundColor Green

# --- Check Node.js ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    # Auto-detect Node.js from known install location
    $nodeExe = "$env:ProgramFiles\nodejs\node.exe"
    if (Test-Path $nodeExe) {
        $nodeDir = Split-Path $nodeExe
        $env:Path = "$nodeDir;$env:Path"
        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentUserPath -notlike "*$nodeDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$currentUserPath;$nodeDir", "User")
            Write-Host "  [OK] Added Node.js to PATH: $nodeDir" -ForegroundColor Green
        }
        $node = Get-Command node -ErrorAction SilentlyContinue
    }
}
if (-not $node) {
    Write-Host "  [ERROR] Node.js not found." -ForegroundColor Red
    Write-Host ""
    Write-Host "  ┌─ What to do: ─────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  1. Install Node.js 18+ from https://nodejs.org/ (LTS recommended)        │" -ForegroundColor Yellow
    Write-Host "  │  2. Re-run:                                                                │" -ForegroundColor Yellow
    Write-Host "  │     irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" -ForegroundColor Yellow
    Write-Host "  └────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
    exit 1
}
$nodeVer = (node --version 2>&1) -replace 'v', ''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Host "  [ERROR] Node.js 18+ required (found $nodeVer)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ┌─ What to do: ─────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
    Write-Host "  │  1. Install Node.js 18+ from https://nodejs.org/ (LTS recommended)        │" -ForegroundColor Yellow
    Write-Host "  │  2. Re-run:                                                                │" -ForegroundColor Yellow
    Write-Host "  │     irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" -ForegroundColor Yellow
    Write-Host "  └────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
    exit 1
}
Write-Host "  [OK] Node.js $nodeVer" -ForegroundColor Green

# --- Check/Install Copilot CLI ---
$copilot = Get-Command copilot -ErrorAction SilentlyContinue
if (-not $copilot) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "  [ERROR] npm not found (should be installed with Node.js)." -ForegroundColor Red
        Write-Host ""
        Write-Host "  ┌─ What to do: ─────────────────────────────────────────────────────────────┐" -ForegroundColor Yellow
        Write-Host "  │  1. Re-install Node.js 18+ from https://nodejs.org/ (LTS recommended)     │" -ForegroundColor Yellow
        Write-Host "  │  2. Re-run:                                                                │" -ForegroundColor Yellow
        Write-Host "  │     irm https://raw.githubusercontent.com/$REPO/main/scripts/install.ps1 | iex" -ForegroundColor Yellow
        Write-Host "  └────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  Installing GitHub Copilot CLI..." -ForegroundColor Yellow
    npm install -g @github/copilot 2>&1 | Out-Null
    $copilot = Get-Command copilot -ErrorAction SilentlyContinue
    if (-not $copilot) {
        Write-Host "  [ERROR] Failed to install Copilot CLI" -ForegroundColor Red
        exit 1
    }
}
$copilotRaw = ((copilot --version 2>&1) | Select-Object -First 1)
$copilotMatch = [regex]::Match($copilotRaw, '(\d+\.\d+\.\d+(?:-\d+)?)')
$copilotVer = if ($copilotMatch.Success) { $copilotMatch.Groups[1].Value } else { "unknown" }
Write-Host "  [OK] Copilot CLI $copilotVer" -ForegroundColor Green

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
Write-Host "  │  ⏳ This may take 5-8 minutes — please wait...     │" -ForegroundColor Yellow
Write-Host "  └─────────────────────────────────────────────────────┘" -ForegroundColor Yellow
Write-Host ""

$installed = $false
$usedPipx = $false
$pipxAvailable = $false
try { $pipxCheck = python -m pipx --version 2>&1 | Out-String; if ($LASTEXITCODE -eq 0) { $pipxAvailable = $true } } catch { }
if ($pipxAvailable) {
    python -m pipx install --force $WHL_URL 2>&1 | ForEach-Object {
        $line = $_.ToString().Trim()
        if ($line -ne '' -and $line -notmatch 'symlink|These apps') {
            Write-Host "  $line" -ForegroundColor DarkGray
        }
    }
    if ($LASTEXITCODE -eq 0) {
        $installed = $true
        $usedPipx = $true
    } else {
        Write-Host "  [WARN] pipx install failed, using python -m pip instead..." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] pipx not found, using python -m pip instead." -ForegroundColor Yellow
}
if (-not $installed) {
    python -m pip install --user --no-cache-dir --force-reinstall $WHL_URL 2>&1 | ForEach-Object {
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
        Write-Host "     python -m pip install $WHL_URL" -ForegroundColor Yellow
    }
}
if (-not $installed) {
    exit 1
}

# Clean up stale dist-info directories that confuse importlib.metadata
$installedVersion = $releaseInfo.tag_name -replace '^v', ''
$siteDir = python -c "import site; print(site.getusersitepackages())" 2>$null
if ($installedVersion -and $siteDir -and (Test-Path $siteDir)) {
    Get-ChildItem -Path $siteDir -Directory -Filter "copilot_console-*.dist-info" | Where-Object {
        $_.Name -ne "copilot_console-$installedVersion.dist-info"
    } | ForEach-Object {
        Remove-Item -Recurse -Force $_.FullName 2>$null
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
    
    # Try winget first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install BurntSushi.ripgrep.MSVC --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        $rg = Get-Command rg -ErrorAction SilentlyContinue
    }
    
    # Fallback: download binary from GitHub releases
    if (-not $rg) {
        $rgVersion = "14.1.1"
        $rgUrl = "https://github.com/BurntSushi/ripgrep/releases/download/$rgVersion/ripgrep-$rgVersion-x86_64-pc-windows-msvc.zip"
        $rgInstallDir = "$env:LOCALAPPDATA\Programs\ripgrep"
        $rgZip = "$env:TEMP\ripgrep.zip"
        try {
            Write-Host "  Downloading ripgrep v$rgVersion binary..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $rgUrl -OutFile $rgZip -UseBasicParsing
            New-Item -ItemType Directory -Path $rgInstallDir -Force | Out-Null
            Expand-Archive -Path $rgZip -DestinationPath "$env:TEMP\ripgrep-extract" -Force
            Copy-Item "$env:TEMP\ripgrep-extract\ripgrep-$rgVersion-x86_64-pc-windows-msvc\rg.exe" "$rgInstallDir\rg.exe" -Force
            Remove-Item $rgZip -Force -ErrorAction SilentlyContinue
            Remove-Item "$env:TEMP\ripgrep-extract" -Recurse -Force -ErrorAction SilentlyContinue
            
            # Add to user PATH if not already there
            $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
            if ($userPath -notlike "*$rgInstallDir*") {
                [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$rgInstallDir", "User")
            }
            $env:Path = "$env:Path;$rgInstallDir"
            $rg = Get-Command rg -ErrorAction SilentlyContinue
        } catch {
            Write-Host "  [WARN] Binary download failed: $_" -ForegroundColor Yellow
        }
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

# --- Optional: Agentic Web Browsing (Playwright MCP) ---
Write-Host ""
Write-Host "  Optional: Agentic Web Browsing" -ForegroundColor Cyan
Write-Host "  Adds autonomous web navigation via Playwright MCP server." -ForegroundColor DarkGray
Write-Host "  Uses your system browser (Edge or Chrome)." -ForegroundColor DarkGray
Write-Host ""
$setupPlaywright = Read-Host "  Enable agentic web browsing? (Y/n)"
if ($setupPlaywright -ne 'n' -and $setupPlaywright -ne 'N') {
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

# --- Optional: Mobile Access & CLI Notifications ---
$mobileEnabled = $false
Write-Host ""
Write-Host "  Optional: Mobile Access & CLI Notifications" -ForegroundColor Cyan
Write-Host "  Access sessions from your phone, get push notifications when" -ForegroundColor DarkGray
Write-Host "  any Copilot CLI session finishes. Requires devtunnel." -ForegroundColor DarkGray
Write-Host ""
$setupMobile = Read-Host "  Enable mobile access & notifications? (Y/n)"
if ($setupMobile -ne 'n' -and $setupMobile -ne 'N') {
    # Enable CLI notifications
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

    # Install devtunnel
    $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
    if (-not $devtunnel) {
        Write-Host "  Installing devtunnel..." -ForegroundColor Yellow
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | Out-Null
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
        }
        if (-not $devtunnel) {
            # Download standalone binary (no npm/admin needed)
            $dtDir = "$env:LOCALAPPDATA\Programs\devtunnel"
            $dtExe = "$dtDir\devtunnel.exe"
            try {
                if (-not (Test-Path $dtDir)) { New-Item -ItemType Directory -Path $dtDir -Force | Out-Null }
                Write-Host "  Downloading devtunnel binary..." -ForegroundColor Yellow
                Invoke-WebRequest -Uri "https://aka.ms/TunnelsCliDownload/win-x64" -OutFile $dtExe -UseBasicParsing
                if (Test-Path $dtExe) {
                    # Add to user PATH if not already there
                    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
                    if ($userPath -notlike "*$dtDir*") {
                        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$dtDir", "User")
                    }
                    $env:Path = "$env:Path;$dtDir"
                    $devtunnel = Get-Command devtunnel -ErrorAction SilentlyContinue
                }
            } catch {
                # download failed — fall through to error message
            }
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
        Write-Host "  TIP: Use a work or school (Entra ID) account for best iOS/Safari support." -ForegroundColor Yellow
        Write-Host "  If you only have a personal account, use --allow-anonymous mode instead." -ForegroundColor DarkGray
        devtunnel user login
        $loginStatus = devtunnel user show 2>&1
        if ($loginStatus -notmatch "Not logged in") {
            Write-Host "  [OK] devtunnel authenticated" -ForegroundColor Green
            $mobileEnabled = $true
        } else {
            Write-Host "  [WARN] devtunnel login was not completed. Run 'devtunnel user login' later." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  Skipped. Enable later with 'cli-notify on' or see docs/guides/MOBILE-COMPANION.md" -ForegroundColor DarkGray
}

# --- Done ---
Write-Host ""
if ($mobileEnabled) {
    Write-Host "  Ready! Complete mobile setup:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    1. Run:  copilot-console --expose --no-sleep" -ForegroundColor White
    Write-Host "    2. Open Settings -> scan QR code on your phone" -ForegroundColor White
    Write-Host "    3. Install as PWA when prompted" -ForegroundColor White
    Write-Host "    4. Allow notifications when the browser asks" -ForegroundColor White
    Write-Host ""
    Write-Host "  After this, CLI notifications work automatically." -ForegroundColor DarkGray
} else {
    Write-Host "  Ready! Run 'copilot-console' to start." -ForegroundColor Cyan
}
Write-Host ""
