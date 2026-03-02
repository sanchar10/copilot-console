# Troubleshooting

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

## SDK / CLI Version Compatibility

Copilot Console uses the [GitHub Copilot Python SDK](https://github.com/github/copilot-sdk) (>=0.1.28) which bundles its own Copilot binary. The Copilot CLI installed via npm is only needed for initial authentication (`copilot login`) — the SDK handles all runtime communication independently.

If you encounter version-related errors, reinstall Copilot Console to get compatible versions:
```powershell
pipx install --force https://github.com/sanchar10/copilot-agent-console/releases/latest/download/copilot_console-py3-none-any.whl
```
