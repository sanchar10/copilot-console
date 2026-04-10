# Mobile Companion

Access Copilot Console securely from your phone — check sessions, read messages, and reply to agents on the go.

## Prerequisites

Requires [devtunnel](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started). If you used the install script or already have it, skip this.

```powershell
# Install (pick one)
winget install Microsoft.devtunnel          # Windows 10/11
npm install -g @msdtunnel/devtunnel-cli     # Any platform

# Authenticate (required once) — use a work or school account (see note below)
devtunnel user login
```

> **Which account to use?** Log in with a **work or school (Microsoft Entra ID) account** for the smoothest experience. Personal Microsoft accounts and GitHub accounts work on Android and desktop browsers, but **fail on Safari/iOS** — Safari downloads an "aad" or "github" file instead of showing the login page due to strict third-party cookie policies. If you don't have a work/school account, use `--allow-anonymous` mode instead (see [Security](#security)).

## Quick Start

1. Start Copilot Console with `--expose`:
   ```powershell
   copilot-console --expose --no-sleep  # --no-sleep keeps the machine awake
   ```

2. Open **Settings** (gear icon) in the desktop UI — you'll see a QR code under **Mobile Companion**.

3. Scan the QR code with your phone's camera. The mobile UI opens in your browser (may run devtunnel auth flow).

That's it. Sessions, messages, and agent status are all accessible from your phone.

> **Stable URL:** A persistent devtunnel is automatically created on first use. The same URL is reused across restarts — no need to re-scan the QR code each time.

## Install on Phone (Home Screen App)

After scanning the QR code and opening the mobile UI, you can install it as a home screen app for a native-like experience — fullscreen, no browser address bar.

### Android (Chrome / Edge)

1. Open the mobile UI via QR code scan
2. Chrome shows an **"Add to Home Screen"** banner at the bottom — tap **Install**
3. If no banner appears: tap the **⋮** menu (top right) → **Add to Home Screen** → **Install**
4. When prompted with **"Open as Web App"**, keep it **On** (this gives you fullscreen mode without the browser address bar)
5. The **Copilot Console** icon appears on your home screen

### iPhone / iPad (Safari)

1. Open the mobile UI via QR code scan **in Safari** (not Chrome — iOS requires Safari for PWA install)
2. Tap the **Share** button (square with arrow, bottom toolbar)
3. Scroll down and tap **Add to Home Screen**
4. When prompted with **"Open as Web App"**, keep it **On** (this gives you fullscreen mode without Safari's address bar)
5. Tap **Add** in the top right
6. The **Copilot Console** icon appears on your home screen

### After Installation

- Tap the home screen icon to launch — opens fullscreen, no browser chrome
- **First launch requires a QR scan** — the home screen app has its own storage, separate from your browser. Scan the QR code once from desktop Settings to connect. After that, the token is saved and you won't need to scan again.
- If the token is regenerated on the desktop, the app shows a **"Session Expired"** screen — scan the new QR code from desktop Settings to reconnect.
- **"Connection Lost"** means the server is unreachable (network issue or server stopped). This resolves automatically when connectivity is restored — no action needed.

## How It Works

`--expose` does three things:

1. **Binds the backend to `0.0.0.0`** so it accepts non-localhost connections
2. **Starts a devtunnel** that creates a secure HTTPS tunnel to your machine
3. **Registers the tunnel URL** with the backend so the desktop UI can generate a QR code

The QR code encodes the tunnel URL plus an API token. Your phone's browser opens the mobile UI and stores the token locally — all subsequent API calls include it automatically.

## Security

### Default: Authenticated Tunnel

By default, only the Microsoft account that created the tunnel can access it. When someone opens the tunnel URL, devtunnel prompts for Microsoft login and verifies it matches the tunnel owner. On top of that, all API calls require a bearer token (embedded in the QR code).

> **Important:** The devtunnel login must use the **same account type** on both the server and the mobile device. **Work or school (Entra ID) accounts** are recommended — they work reliably on all platforms including Safari/iOS. Personal Microsoft accounts and GitHub accounts work on Android and desktop browsers, but **fail on Safari/iOS** (Safari downloads an "aad" or "github" file instead of showing login).

### Anonymous Mode (for use without Microsoft work / school account)

```powershell
copilot-console --expose --allow-anonymous
```

Skips the Microsoft login — anyone with the tunnel URL can reach the server. The bearer token still protects all API endpoints, so access is still secure — you need the QR code to connect.

**Use anonymous mode if:**
- You don't have a work or school (Microsoft Entra ID) account
- You're accessing from an iPhone/iPad and logged in with a personal Microsoft or GitHub account

The tunnel URL is randomly generated and not discoverable — combined with the bearer token, this provides strong security for personal use.

### Token Management

- **Token generation**: A cryptographically random token is auto-generated on first use and stored in `~/.copilot-console/settings.json`
- **Regeneration**: Click "Regenerate" in Settings to invalidate the current token. All connected phones lose access until they scan the new QR code.
- **REST calls**: Token sent in `Authorization: Bearer <token>` header
- **SSE streams**: Token sent as `?token=<token>` query parameter (EventSource API limitation)

## Mobile UI

The mobile interface is purpose-built for phone screens with three tabs:

| Tab | What it shows |
|---|---|
| **Sessions** | All sessions with unread blue dot indicators, pull-to-refresh |
| **Chat** | Message history with live streaming responses, reply and abort |
| **Agents** | Live feed of active agent sessions with auto-reconnect |

### Key behaviors

- **Pull to refresh** — swipe down on the session list to refresh, or tap the refresh button
- **Push notifications** — get notified when agents complete, even when the app is in the background
- **Live updates** — agent status streams in real-time and auto-reconnects if the connection drops
- **Works on iPhone and Android** — optimized for both platforms, including notch and home indicator safe areas

## Troubleshooting

### iOS: App shows "Zero KB" or blank page when server is down
This is a known iOS/WebKit limitation — iOS bypasses the service worker entirely when the origin is unreachable.

When you see "Zero KB", just restart the server and reopen the app. The tunnel URL stays the same (persistent devtunnel), so the app reconnects automatically — no need to re-scan the QR code.

> **Note:** This does not affect Android — the service worker works correctly there.

### Phone shows "Session Expired"
The API token was regenerated. Scan the new QR code from desktop Settings.

### Phone shows "Connection Lost"
The server is unreachable (network issue or server stopped). This resolves automatically when connectivity is restored — no action needed.

### "Add to Home Screen" option not appearing (iPhone)
PWA install only works in **Safari** on iOS. If you opened the link in Chrome, Google, or another browser, copy the URL and open it in Safari, then use Share → Add to Home Screen.

### Phone shows "Connection Setup" screen
The token or URL is missing. Scan the QR code again from the desktop console Settings.

### Phone can't load after token regeneration
The old token in your phone's localStorage is now invalid. Scan the new QR code from Settings.

### devtunnel not found
Install with `winget install Microsoft.devtunnel`, then authenticate with `devtunnel user login`.

### Tunnel SSH window warnings in console
Messages like "SshChannel send window is full" are normal devtunnel noise from long-lived SSE connections. They don't affect functionality.

### Phone browser stuck on wrong Microsoft account
Clear cookies in your mobile browser (Settings → Privacy → Clear browsing data → Cookies), or open the tunnel URL in an InPrivate/Incognito tab.

### Safari downloads "aad" or "github" file instead of showing login
This happens when devtunnel is authenticated with a personal Microsoft account or GitHub account. Safari's strict third-party cookie policy blocks the auth redirect. **Fix:** Either switch to a work/school account (`devtunnel user login`) or use anonymous mode (`--allow-anonymous`).
