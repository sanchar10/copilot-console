# Troubleshooting

## General Issues

### `copilot-console` command not found
- If installed with `pipx`: Run `pipx ensurepath` and **restart the terminal**
- If installed with `pip`: Try `python -m copilot_console.cli`
- Verify Python's Scripts directory is in PATH: `$env:PATH -split ';' | Select-String Python`

### "github-copilot-sdk not found"
The SDK should be installed automatically as a dependency. If it's missing:
```powershell
pipx inject copilot-console github-copilot-sdk
```

### Agent not responding to messages
The Copilot CLI must be authenticated with an account that has Copilot access:
1. Ensure an active [GitHub Copilot subscription](https://github.com/settings/copilot) is in place
2. Run `copilot login` in a terminal and complete the device code flow
3. **Sign in with the GitHub account that has the Copilot subscription** — if you have multiple accounts, the wrong one may not have access
4. Restart Copilot Console

### "Not authorized" or "requires an enterprise or organization policy"
This means the logged-in GitHub account doesn't have Copilot access. Run `copilot login` and authenticate with an account that has an active [Copilot subscription](https://github.com/settings/copilot) (individual, organization, or enterprise).

### Scheduled tasks don't run when PC is sleeping
Use the `--no-sleep` flag to prevent Windows from going to sleep:
```powershell
copilot-console --no-sleep
```
This only prevents idle sleep — manual sleep is still possible.

### Port already in use
```powershell
copilot-console --port 9000
```

## MCP Servers

### MCP server sign-in fails with "EACCES: permission denied 127.0.0.1:`<port>`"

**Cause:** The MCP server's OAuth callback uses a fixed localhost port that was chosen during the SDK's initial dynamic client registration. If Windows has since reserved that port (Hyper-V, WSL2, and Docker dynamically reserve port ranges that change on reboot/service restart), the SDK can no longer bind to it and sign-in fails immediately.

You can confirm the conflict with:
```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```
If the port from the error message falls inside any reserved range, that's the cause.

**Fix — re-register with a fresh port:**
Delete the SDK's cached registration for the affected server, then sign in again. The SDK will pick a new port and re-register.
```powershell
# Find the file matching your server — each .json contains the server URL.
# Delete both the matching <hash>.json and <hash>.tokens.json.
Get-ChildItem "$env:USERPROFILE\.copilot\mcp-oauth-config\*.json" -Exclude *.tokens.json |
  ForEach-Object { Write-Host $_.Name; Get-Content $_ | Select-String 'serverUrl' }
```
Then `Remove-Item` the matching `<hash>.json` and `<hash>.tokens.json`, and click **Sign in** on the MCP server in the dropdown.

### MCP servers added externally don't appear until app restart

**Cause:** The console reads `mcp-config.json` (and the agent-only override) **once at startup** and caches the list in memory. This avoids a disk re-read on every session open. Servers added or removed via the in-app **Settings → MCP Servers** tab update the cache automatically — but edits made directly to the JSON files (or by another tool while the app is running) won't be picked up until the next launch.

**Fix:** Restart `copilot-console`. After the app reopens, the new server appears in the per-session MCP picker and (if you toggled **Auto-enable** for it) is pre-selected for new sessions.

If you'd rather not restart, add/edit the server through **Settings → MCP Servers → Add Server / Edit** — those paths refresh the in-memory cache immediately.

## macOS Issues

### Python: use `python3` not `python`

On macOS, the system Python (`python`) is often Python 2, which is outdated. Always use `python3`:

```bash
# Correct
python3 --version    # Should show 3.11+
pip3 install ...

# Incorrect
python --version     # May be Python 2
```

When installing or using Python packages, use `python3 -m pip` or `pip3` to ensure you're using the correct version.

### Sleep Prevention Doesn't Work (caffeinate not active)

If Copilot Console is scheduled to run automations but your Mac is still sleeping, the `caffeinate` command may not be running properly.

**Check Activity Monitor:**
1. Open Activity Monitor (Cmd+Space, type "Activity Monitor")
2. Search for `caffeinate` in the Process list
3. If not found, check Console.app for errors: Cmd+Space → "Console" → search for "caffeinate"

**Workaround:** Manually keep your Mac awake using System Preferences → Battery → disable "Turn display off after" and "Put hard disks to sleep"

### devtunnel: Install via Homebrew on macOS

If you want to access Copilot Console from your phone (`--expose` flag), install devtunnel using Homebrew:

```bash
brew install --cask devtunnel
```

Then authenticate:
```bash
devtunnel user login
```

Verify:
```bash
devtunnel --version
```

## SDK / CLI Version Compatibility

Copilot Console uses the [GitHub Copilot Python SDK](https://github.com/github/copilot-sdk) (>=0.1.28) which bundles its own Copilot binary. The Copilot CLI installed via npm is only needed for initial authentication (`copilot login`) — the SDK handles all runtime communication independently.

If you encounter version-related errors, reinstall Copilot Console to get compatible versions:
```powershell
pipx install --force https://github.com/sanchar10/copilot-console/releases/download/v0.5.0/copilot_console-0.5.0-py3-none-any.whl
```
