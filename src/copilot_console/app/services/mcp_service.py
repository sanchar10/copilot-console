"""MCP Server configuration service.

Reads MCP server configurations from three sources:
1. Global config: ~/.copilot/mcp-config.json (shared with CLI)
2. Plugin configs: ~/.copilot/installed-plugins/copilot-plugins/[plugin]/.mcp.json
3. Agent-only config: ~/.copilot-console/mcp-config.json (only visible to this app)

Concurrency contract (Phase 3 S1, S3):
- One asyncio.Lock per writable scope file. Read-modify-write happens entirely
  inside the lock so two concurrent CRUD operations against the same scope
  cannot lose each other's writes.
- The in-memory cache is treated as immutable: writers build a new
  MCPServerConfig and rebind self._cached_config in a single assignment.
  Concurrent readers either see the old config or the new one — never a
  half-updated structure.
- No mtime polling. The cache is loaded once on first read and only
  rebuilt by explicit CRUD operations or refresh().
"""

import asyncio
import json
from pathlib import Path

from copilot_console.app.config import APP_HOME
from copilot_console.app.models.mcp import MCPServer, MCPServerConfig, MCPServerScope
from copilot_console.app.services.logging_service import get_logger
from copilot_console.app.services.storage_service import atomic_write_json, storage_service

logger = get_logger(__name__)

# Paths for MCP configuration
COPILOT_HOME = Path.home() / ".copilot"
GLOBAL_MCP_CONFIG = COPILOT_HOME / "mcp-config.json"
PLUGINS_DIR = COPILOT_HOME / "installed-plugins" / "copilot-plugins"
AGENT_ONLY_MCP_CONFIG = APP_HOME / "mcp-config.json"
OAUTH_CONFIG_DIR = COPILOT_HOME / "mcp-oauth-config"


# ---------- Exceptions ---------------------------------------------------------

class MCPCRUDError(Exception):
    """Base for MCP CRUD failures (validation, permissions, conflicts)."""


class MCPNotFoundError(MCPCRUDError):
    """Raised when a server name cannot be located in any source."""


class MCPReadOnlyError(MCPCRUDError):
    """Raised when a write is attempted against a plugin (read-only) server."""


class MCPNameConflictError(MCPCRUDError):
    """Raised when adding a server whose name already exists in any source."""


class MCPInvalidConfigError(MCPCRUDError):
    """Raised when the config dict fails shape validation."""


# ---------- Helpers ------------------------------------------------------------

def _scope_path(scope: MCPServerScope) -> Path:
    if scope is MCPServerScope.GLOBAL:
        return GLOBAL_MCP_CONFIG
    if scope is MCPServerScope.AGENT_ONLY:
        return AGENT_ONLY_MCP_CONFIG
    raise ValueError(f"Unknown scope: {scope}")


def _read_scope_file(path: Path) -> dict:
    """Load a scope config file. Returns {} if missing or empty."""
    if not path.exists():
        return {"mcpServers": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"mcpServers": {}}
        if "mcpServers" not in data or not isinstance(data["mcpServers"], dict):
            data["mcpServers"] = {}
        return data
    except json.JSONDecodeError as exc:
        raise MCPInvalidConfigError(f"Cannot parse {path.name}: {exc}") from exc


def _validate_inner_config(config: dict) -> None:
    """Verify the inner server config dict has the minimum shape we need."""
    if not isinstance(config, dict):
        raise MCPInvalidConfigError("Server config must be a JSON object")

    raw_type = config.get("type")
    is_remote = raw_type in ("http", "sse", "remote") or bool(config.get("url"))
    if is_remote:
        if not isinstance(config.get("url"), str) or not config["url"]:
            raise MCPInvalidConfigError("Remote server config requires a non-empty 'url'")
    else:
        if not isinstance(config.get("command"), str) or not config["command"]:
            raise MCPInvalidConfigError("Local server config requires a non-empty 'command'")
        args = config.get("args", [])
        if args is not None and not isinstance(args, list):
            raise MCPInvalidConfigError("'args' must be a list of strings if present")


# ---------- Service ------------------------------------------------------------


class MCPService:
    """Service to discover and manage MCP server configurations."""

    def __init__(self) -> None:
        self._cached_config: MCPServerConfig | None = None
        # Per-writable-scope locks. Plugin scope is read-only (no lock needed).
        self._scope_locks: dict[MCPServerScope, asyncio.Lock] = {
            MCPServerScope.GLOBAL: asyncio.Lock(),
            MCPServerScope.AGENT_ONLY: asyncio.Lock(),
        }

    # ---------- Parser (unchanged) ------------------------------------------

    def _parse_mcp_servers_from_json(
        self, data: dict, source: str
    ) -> list[MCPServer]:
        """Parse mcpServers from JSON config data.

        Supports both local (command-based) and remote (url-based) servers.
        """
        servers: list[MCPServer] = []

        mcp_servers = data.get("mcpServers", {})
        if not isinstance(mcp_servers, dict):
            return servers

        # Map legacy/alias type names to canonical SDK 0.3.0 names
        type_aliases = {"local": "stdio", "remote": "http"}

        for name, config in mcp_servers.items():
            if not isinstance(config, dict):
                continue

            try:
                raw_type = config.get("type")
                server_type = type_aliases.get(raw_type, raw_type) if isinstance(raw_type, str) else raw_type
                tools = config.get("tools", ["*"])
                timeout = config.get("timeout")
                oauth_client_id = config.get("oauthClientId") or config.get("oauth_client_id")
                oauth_public_client = config.get("oauthPublicClient")
                if oauth_public_client is None:
                    oauth_public_client = config.get("oauth_public_client")

                # Determine if this is a remote server (http/sse)
                is_remote = server_type in ("http", "sse") or "url" in config

                # Capture the verbatim inner JSON for round-trip in the JSON-first
                # editor. We deep-copy so later parser-side normalisation can't
                # mutate it; defensive against future refactors that hand the
                # dict to other code paths.
                raw_snapshot = json.loads(json.dumps(config))

                if is_remote:
                    url = config.get("url", "")
                    if not url:
                        logger.warning(f"Remote MCP server '{name}' has no url, skipping")
                        continue
                    server = MCPServer(
                        name=name,
                        type=server_type or "http",
                        url=url,
                        headers=config.get("headers"),
                        tools=tools if isinstance(tools, list) else [str(tools)],
                        timeout=timeout,
                        oauth_client_id=oauth_client_id,
                        oauth_public_client=oauth_public_client,
                        source=source,
                        raw_config=raw_snapshot,
                    )
                else:
                    command = config.get("command", "")
                    if not command:
                        logger.warning(f"MCP server '{name}' has no command, skipping")
                        continue
                    args = config.get("args", [])
                    server = MCPServer(
                        name=name,
                        type=server_type,
                        command=command,
                        args=args if isinstance(args, list) else [str(args)],
                        env=config.get("env"),
                        cwd=config.get("cwd"),
                        tools=tools if isinstance(tools, list) else [str(tools)],
                        timeout=timeout,
                        source=source,
                        raw_config=raw_snapshot,
                    )

                servers.append(server)
                logger.info(f"Loaded MCP server: {name} (type={server_type}) from {source}")
            except Exception as e:
                logger.warning(f"Failed to parse MCP server '{name}': {e}")

        return servers

    # ---------- Loaders -----------------------------------------------------

    def _load_global_config(self) -> list[MCPServer]:
        """Load MCP servers from global config file."""
        if not GLOBAL_MCP_CONFIG.exists():
            logger.info(f"Global MCP config not found: {GLOBAL_MCP_CONFIG}")
            return []

        try:
            data = json.loads(GLOBAL_MCP_CONFIG.read_text(encoding="utf-8"))
            servers = self._parse_mcp_servers_from_json(data, "global")
            servers.sort(key=lambda s: s.name.lower())
            return servers
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse global MCP config: {e}")
            return []
        except Exception as e:
            logger.error(f"Error reading global MCP config: {e}")
            return []

    def _load_plugin_configs(self) -> list[MCPServer]:
        """Load MCP servers from all plugin .mcp.json files."""
        servers: list[MCPServer] = []

        if not PLUGINS_DIR.exists():
            logger.info(f"Plugins directory not found: {PLUGINS_DIR}")
            return servers

        for plugin_dir in sorted(PLUGINS_DIR.iterdir(), key=lambda p: p.name.lower()):
            if not plugin_dir.is_dir():
                continue

            mcp_json = plugin_dir / ".mcp.json"
            if not mcp_json.exists():
                continue

            try:
                data = json.loads(mcp_json.read_text(encoding="utf-8"))
                plugin_name = plugin_dir.name
                plugin_servers = self._parse_mcp_servers_from_json(data, plugin_name)
                plugin_servers.sort(key=lambda s: s.name.lower())
                servers.extend(plugin_servers)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse plugin MCP config {mcp_json}: {e}")
            except Exception as e:
                logger.error(f"Error reading plugin MCP config {mcp_json}: {e}")

        return servers

    def _load_agent_only_config(self) -> list[MCPServer]:
        """Load MCP servers from agent-only config file."""
        if not AGENT_ONLY_MCP_CONFIG.exists():
            logger.info(f"Agent-only MCP config not found: {AGENT_ONLY_MCP_CONFIG}")
            return []

        try:
            data = json.loads(AGENT_ONLY_MCP_CONFIG.read_text(encoding="utf-8"))
            servers = self._parse_mcp_servers_from_json(data, "agent-only")
            servers.sort(key=lambda s: s.name.lower())
            return servers
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse agent-only MCP config: {e}")
            return []
        except Exception as e:
            logger.error(f"Error reading agent-only MCP config: {e}")
            return []

    def _build_config(self) -> MCPServerConfig:
        """Build a fresh MCPServerConfig from disk (no caching)."""
        servers: list[MCPServer] = []
        servers.extend(self._load_global_config())
        servers.extend(self._load_plugin_configs())
        servers.extend(self._load_agent_only_config())
        logger.info(f"Loaded {len(servers)} MCP servers total")
        return MCPServerConfig(servers=servers)

    def _rebuild_cache(self) -> MCPServerConfig:
        """Rebuild the cache from disk and atomically rebind it (S3).

        Constructs the new MCPServerConfig fully, then assigns to
        self._cached_config in a single statement. Readers always see
        either the previous config or the fully built new one, never a
        half-populated state.
        """
        new_config = self._build_config()
        self._cached_config = new_config
        return new_config

    # ---------- Read APIs ---------------------------------------------------

    def get_available_servers(self, force_refresh: bool = False) -> MCPServerConfig:
        """Get all available MCP server configurations.

        The cache is loaded once on first call and only rebuilt explicitly
        (force_refresh, refresh(), or after a CRUD write). No mtime polling.
        Out-of-process changes to the JSON files are NOT picked up until the
        next CRUD operation or process restart — this is intentional per the
        Phase 3 design.
        """
        if force_refresh or self._cached_config is None:
            return self._rebuild_cache()
        return self._cached_config

    def get_servers_for_sdk(self, selections: list[str]) -> dict[str, dict]:
        """Get MCP servers formatted for the Copilot SDK."""
        selected = set(selections)
        config = self.get_available_servers()
        sdk_servers: dict[str, dict] = {}

        for server in config.servers:
            if server.name not in selected:
                continue

            is_remote = server.type in ("http", "sse")

            if is_remote:
                server_config: dict = {
                    "type": server.type,
                    "url": server.url,
                    "tools": server.tools,
                }
                if server.headers:
                    server_config["headers"] = server.headers
                if server.oauth_client_id is not None:
                    server_config["oauthClientId"] = server.oauth_client_id
                if server.oauth_public_client is not None:
                    server_config["oauthPublicClient"] = server.oauth_public_client
            else:
                server_config = {
                    "command": server.command,
                    "args": server.args,
                    "tools": server.tools,
                }
                if server.type:
                    server_config["type"] = server.type
                if server.env:
                    server_config["env"] = server.env
                if server.cwd:
                    server_config["cwd"] = server.cwd

            if server.timeout is not None:
                server_config["timeout"] = server.timeout

            if server.name in sdk_servers:
                logger.warning(
                    f"Duplicate MCP server name '{server.name}' across sources — later definition overwrites earlier. "
                    f"Source of overwriting entry: {server.source}"
                )
            sdk_servers[server.name] = server_config

        return sdk_servers

    def refresh(self) -> MCPServerConfig:
        """Force refresh the MCP server cache."""
        return self.get_available_servers(force_refresh=True)

    # ---------- CRUD --------------------------------------------------------

    def find_server(self, name: str) -> MCPServer | None:
        """Locate a server in the current cache by name (any scope)."""
        config = self.get_available_servers()
        for server in config.servers:
            if server.name == name:
                return server
        return None

    async def add_server(
        self,
        scope: MCPServerScope,
        name: str,
        config: dict,
    ) -> MCPServer:
        """Add a new MCP server to the given writable scope.

        Raises:
            MCPNameConflictError: if `name` already exists in any source.
            MCPInvalidConfigError: if `config` lacks command/url or is malformed.
            MCPReadOnlyError: if `scope` is not a writable scope.
            MCPCRUDError: for any other write failure.
        """
        if not isinstance(scope, MCPServerScope):
            raise MCPReadOnlyError(f"Scope {scope!r} is not writable")
        _validate_inner_config(config)

        path = _scope_path(scope)
        async with self._scope_locks[scope]:
            # Re-read inside the lock so concurrent adds to the same scope
            # see each other's writes (S1).
            existing = self.find_server(name)
            if existing is not None:
                raise MCPNameConflictError(
                    f"Server '{name}' already exists in source '{existing.source}'"
                )

            data = _read_scope_file(path)
            if name in data["mcpServers"]:
                # Disk has a server the cache doesn't know about — refuse rather
                # than silently overwrite. (Possible if user edited file out-of-band.)
                raise MCPNameConflictError(
                    f"Server '{name}' already present on disk in {scope.value} scope"
                )

            data["mcpServers"][name] = config
            atomic_write_json(path, data)
            self._rebuild_cache()

        server = self.find_server(name)
        if server is None:
            # Should be impossible — parser rejected it after a successful write.
            raise MCPCRUDError(f"Server '{name}' was written but not parsable on reload")
        return server

    async def update_server(self, name: str, config: dict) -> MCPServer:
        """Replace an existing writable server's inner JSON with `config`.

        Cannot move a server between scopes. To rename or change scope,
        delete + add.

        Raises:
            MCPNotFoundError: if no server by that name exists.
            MCPReadOnlyError: if the server lives in a plugin source.
            MCPInvalidConfigError: if `config` fails shape validation.
        """
        _validate_inner_config(config)

        existing = self.find_server(name)
        if existing is None:
            raise MCPNotFoundError(f"Server '{name}' not found")
        if not existing.is_writable:
            raise MCPReadOnlyError(
                f"Server '{name}' is provided by plugin '{existing.plugin_name}' and cannot be edited"
            )

        scope = MCPServerScope(existing.source)
        path = _scope_path(scope)

        async with self._scope_locks[scope]:
            data = _read_scope_file(path)
            if name not in data["mcpServers"]:
                # Cache and disk are out of sync — refuse to silently re-create.
                raise MCPNotFoundError(
                    f"Server '{name}' missing from {scope.value} on disk"
                )
            data["mcpServers"][name] = config
            atomic_write_json(path, data)
            self._rebuild_cache()

        server = self.find_server(name)
        if server is None:
            raise MCPCRUDError(f"Server '{name}' was written but not parsable on reload")
        return server

    async def delete_server(self, name: str) -> None:
        """Delete a writable server. Also clears its mcp_auto_enable entry.

        Raises:
            MCPNotFoundError: if no server by that name exists.
            MCPReadOnlyError: if the server lives in a plugin source.
        """
        existing = self.find_server(name)
        if existing is None:
            raise MCPNotFoundError(f"Server '{name}' not found")
        if not existing.is_writable:
            raise MCPReadOnlyError(
                f"Server '{name}' is provided by plugin '{existing.plugin_name}' and cannot be deleted"
            )

        scope = MCPServerScope(existing.source)
        path = _scope_path(scope)

        async with self._scope_locks[scope]:
            data = _read_scope_file(path)
            if name not in data["mcpServers"]:
                # Already gone from disk; treat as success but rebuild cache.
                self._rebuild_cache()
            else:
                data["mcpServers"].pop(name)
                atomic_write_json(path, data)
                self._rebuild_cache()

        # Cleanup the auto-enable map so deleted servers don't linger as
        # ghost selections in new sessions.
        try:
            storage_service.remove_mcp_auto_enable(name)
        except Exception as exc:
            logger.warning(f"Failed to clear mcp_auto_enable for '{name}': {exc}")

    async def reset_oauth(self, name: str) -> dict:
        """Delete the OAuth registration + tokens files for a remote server.

        Locates files under ~/.copilot/mcp-oauth-config/*.json whose
        `serverUrl` matches the server's URL, and removes both the
        registration JSON and its sibling `.tokens.json` file.

        Raises:
            MCPNotFoundError: if no server by that name exists.
            MCPInvalidConfigError: if the server has no URL (e.g., it's a
                local stdio server — OAuth doesn't apply).

        Returns:
            {"removed": [filenames...], "scanned": <int>} for diagnostics.
        """
        server = self.find_server(name)
        if server is None:
            raise MCPNotFoundError(f"Server '{name}' not found")
        if not server.url:
            raise MCPInvalidConfigError(
                f"Server '{name}' has no URL; OAuth reset only applies to remote servers"
            )

        removed: list[str] = []
        scanned = 0
        target_url = server.url.rstrip("/")

        if not OAUTH_CONFIG_DIR.exists():
            return {"removed": removed, "scanned": scanned}

        for entry in OAUTH_CONFIG_DIR.iterdir():
            if not entry.is_file() or entry.suffix != ".json":
                continue
            # Skip *.tokens.json on this pass — they're handled alongside
            # their parent registration file below.
            if entry.name.endswith(".tokens.json"):
                continue
            scanned += 1
            try:
                payload = json.loads(entry.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning(f"Skipping unreadable OAuth registration {entry.name}: {exc}")
                continue

            registered_url = (payload.get("serverUrl") or "").rstrip("/")
            if not registered_url or registered_url != target_url:
                continue

            # Remove registration + sibling tokens file.
            tokens_file = entry.with_name(entry.stem + ".tokens.json")
            try:
                entry.unlink()
                removed.append(entry.name)
            except OSError as exc:
                logger.warning(f"Failed to delete OAuth registration {entry.name}: {exc}")
            if tokens_file.exists():
                try:
                    tokens_file.unlink()
                    removed.append(tokens_file.name)
                except OSError as exc:
                    logger.warning(f"Failed to delete OAuth tokens {tokens_file.name}: {exc}")

        logger.info(
            f"OAuth reset for '{name}' (url={target_url}): scanned={scanned} removed={removed}"
        )
        return {"removed": removed, "scanned": scanned}


# Singleton instance
mcp_service = MCPService()
