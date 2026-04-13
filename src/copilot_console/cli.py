"""CLI entry point for Copilot Console."""

import argparse
import os
import sys
import webbrowser
from pathlib import Path
from threading import Timer

def check_copilot_sdk():
    """Check if github-copilot-sdk is available."""
    try:
        import copilot  # noqa: F401
        return True
    except ImportError:
        return False

def initialize_app_directory():
    """Create application directory and default files on first run."""
    import json
    import shutil
    
    app_home = Path.home() / ".copilot-console"
    
    # Create directories
    (app_home / "sessions").mkdir(parents=True, exist_ok=True)
    (app_home / "tools").mkdir(exist_ok=True)
    
    # Create default settings if not exists
    settings_file = app_home / "settings.json"
    if not settings_file.exists():
        from copilot_console.app.config import DEFAULT_MODEL
        settings_file.write_text(json.dumps({
            "default_model": DEFAULT_MODEL,
            "default_cwd": str(Path.home()),
        }, indent=2), encoding="utf-8")
        print(f"✓ Created settings at {settings_file}")
    
    # Seed bundled content (agents, skills, tools, MCP servers) on install/update
    from copilot_console.app.services.seed_service import seed_bundled_content
    seed_bundled_content()
    
    return app_home


def open_browser_delayed(url: str, delay: float = 1.5):
    """Open browser after a short delay to let server start."""
    def _open():
        webbrowser.open(url)
    Timer(delay, _open).start()

def main():
    """Main entry point for Copilot Console."""
    # Force UTF-8 stdout/stderr on Windows to handle emoji and Unicode in print()
    if sys.platform == "win32" and hasattr(sys.stdout, "fileno"):
        try:
            sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', errors='replace', closefd=False)
            sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', errors='replace', closefd=False)
        except (OSError, ValueError):
            pass

    parser = argparse.ArgumentParser(
        prog="copilot-console",
        description="Copilot Console - A feature-rich console for GitHub Copilot agents",
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8765,
        help="Port to run the server on (default: 8765)"
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't automatically open browser"
    )
    parser.add_argument(
        "--no-sleep",
        action="store_true",
        help="Prevent Windows from sleeping while the app is running (useful for automated tasks)"
    )
    parser.add_argument(
        "--expose",
        action="store_true",
        help="Bind to 0.0.0.0 and start devtunnel for mobile companion access"
    )
    parser.add_argument(
        "--allow-anonymous",
        action="store_true",
        help="Allow anonymous tunnel access (default: authenticated, same Microsoft account only). Requires --expose."
    )
    parser.add_argument(
        "--version", "-v",
        action="store_true",
        help="Show version and exit"
    )
    
    args = parser.parse_args()
    
    if args.version:
        from copilot_console import __version__
        print(f"Copilot Console v{__version__}")
        return 0
    
    # Check dependencies
    if not check_copilot_sdk():
        print("""
╔══════════════════════════════════════════════════════════════╗
║  Error: github-copilot-sdk not found!                        ║
║                                                              ║
║  Install it with: pip install github-copilot-sdk             ║
╚══════════════════════════════════════════════════════════════╝
        """)
        return 1
    
    # Initialize app directory
    app_home = initialize_app_directory()
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                   Copilot Console                            ║
║      A feature-rich console for GitHub Copilot agents        ║
╚══════════════════════════════════════════════════════════════╝

  App data:  {app_home}
  Server:    http://{args.host}:{args.port}
    """)
    
    # Open browser (delayed)
    if not args.no_browser:
        url = f"http://{args.host}:{args.port}"
        print(f"  Opening browser to {url}...")
        open_browser_delayed(url)
    
    # Prevent sleep if requested
    if args.no_sleep:
        os.environ["COPILOT_NO_SLEEP"] = "1"
        if sys.platform == "win32":
            print("  🔋 Sleep prevention enabled (Windows will stay awake)")
        else:
            print("  ⚠️  --no-sleep is only supported on Windows")

    # Expose mode: bind to 0.0.0.0 and start persistent devtunnel
    host = args.host
    tunnel_proc = None
    if args.expose:
        host = "0.0.0.0"
        os.environ["COPILOT_EXPOSE"] = "1"
        print("  📱 Expose mode enabled — accessible from other devices")
        
        # Start persistent devtunnel
        tunnel_proc = _start_devtunnel(args.port, args.allow_anonymous, app_home)

    print("\n  Press Ctrl+C to stop the server.\n")
    
    # Start server
    import uvicorn
    try:
        uvicorn.run(
            "copilot_console.app.main:app",
            host=host,
            port=args.port,
            log_level="info",
        )
    finally:
        if tunnel_proc:
            tunnel_proc.terminate()
    
    return 0


def _start_devtunnel(port, allow_anonymous, app_home):
    """Start a persistent devtunnel for mobile companion access."""
    import json
    import shutil
    import subprocess
    import threading
    import re
    import time
    
    # Check devtunnel is installed
    if not shutil.which("devtunnel"):
        if sys.platform == "darwin":
            print("  ⚠️  devtunnel CLI not found — install with: brew install --cask devtunnel")
        elif sys.platform == "win32":
            print("  ⚠️  devtunnel CLI not found — install with: winget install Microsoft.devtunnel")
        else:
            print("  ⚠️  devtunnel CLI not found — install with: npm install -g @msdtunnel/devtunnel-cli")
        print("     Then: devtunnel user login")
        return None
    
    settings_file = app_home / "settings.json"
    tunnel_id = None
    
    # Load saved tunnel ID
    try:
        if settings_file.exists():
            settings = json.loads(settings_file.read_text(encoding="utf-8"))
            tunnel_id = settings.get("devtunnel_id")
    except Exception:
        pass
    
    # Verify saved tunnel still exists
    if tunnel_id:
        try:
            subprocess.run(
                ["devtunnel", "show", tunnel_id],
                capture_output=True, timeout=10
            ).check_returncode()
            print(f"  ✓ Reusing persistent tunnel: {tunnel_id}")
        except Exception:
            print(f"  ⚠ Saved tunnel {tunnel_id} no longer exists, creating new one...")
            tunnel_id = None
    
    # Create persistent tunnel if none exists
    if not tunnel_id:
        print("  🔗 Creating persistent devtunnel...")
        try:
            result = subprocess.run(
                ["devtunnel", "create", "-j"],
                capture_output=True, text=True, timeout=30
            )
            result.check_returncode()
            # devtunnel may print banner text before JSON — extract the JSON object
            import re
            json_match = re.search(r'\{[\s\S]*\}', result.stdout)
            if not json_match:
                raise ValueError("No JSON in devtunnel output")
            parsed = json.loads(json_match.group())
            tunnel_id = parsed.get("tunnel", {}).get("tunnelId") or parsed.get("tunnelId")
            print(f"  ✓ Created tunnel: {tunnel_id}")
            
            # Add port
            subprocess.run(
                ["devtunnel", "port", "create", tunnel_id, "-p", str(port)],
                capture_output=True, timeout=15
            )
            print(f"  ✓ Port {port} configured")
            
            # Save tunnel ID
            settings = {}
            try:
                if settings_file.exists():
                    settings = json.loads(settings_file.read_text(encoding="utf-8"))
            except Exception:
                pass
            settings["devtunnel_id"] = tunnel_id
            settings_file.write_text(json.dumps(settings, indent=2), encoding="utf-8")
            print("  ✓ Tunnel ID saved to settings")
        except Exception as e:
            print(f"  ⚠️  Failed to create tunnel: {e}")
            return None
    
    # Handle anonymous access
    if allow_anonymous and tunnel_id:
        try:
            subprocess.run(
                ["devtunnel", "access", "create", tunnel_id, "-a"],
                capture_output=True, timeout=10
            )
        except Exception:
            pass
    
    # Start devtunnel host
    mode = "anonymous access" if allow_anonymous else "authenticated — same account only"
    print(f"  🔗 Starting devtunnel ({mode})...")
    
    tunnel_proc = subprocess.Popen(
        ["devtunnel", "host", tunnel_id],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    
    # Background thread to parse tunnel URL and register with backend
    def _monitor_tunnel():
        url_pattern = re.compile(r"Connect via browser:\s+(https://[^\s,]+)")
        tunnel_url = None
        for line in iter(tunnel_proc.stdout.readline, b""):
            text = line.decode("utf-8", errors="replace")
            if not tunnel_url:
                match = url_pattern.search(text)
                if match:
                    tunnel_url = match.group(1).rstrip("/")
                    print(f"\n  📱 Tunnel active: {tunnel_url}")
                    print(f"     Mobile URL: {tunnel_url}/mobile")
                    print("     Open Settings in desktop UI to see the QR code\n")
                    # Register with backend
                    _register_tunnel_url(tunnel_url, port)
    
    thread = threading.Thread(target=_monitor_tunnel, daemon=True)
    thread.start()
    
    return tunnel_proc


def _register_tunnel_url(tunnel_url, port, retries=10):
    """Register the tunnel URL with the backend API."""
    import json
    import time
    import urllib.request
    
    data = json.dumps({"tunnel_url": tunnel_url}).encode("utf-8")
    
    for i in range(retries):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/settings/mobile-companion/tunnel-url",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
            print("  ✓ Tunnel URL registered with backend")
            return
        except Exception:
            time.sleep(2)
    
    print("  ⚠ Could not register tunnel URL — enter it manually in Settings")

if __name__ == "__main__":
    sys.exit(main())
