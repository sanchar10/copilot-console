"""Local Tools service.

Loads tool definitions from ~/.copilot-web/tools/ folder.
Each .py file can define one or more tools via TOOL_SPECS list.
"""

import asyncio
import importlib.util
import inspect
import json
import sys
from pathlib import Path
from typing import Any, Callable

from copilot.tools import Tool, ToolInvocation, ToolResult as SDKToolResult

from copilot_console.app.models.tools import ToolInfo, ToolSpecWithHandler, ToolResult, ToolsConfig
from copilot_console.app.config import TOOLS_DIR
from copilot_console.app.services.logging_service import get_logger

logger = get_logger(__name__)


class ToolsService:
    """Service to discover and manage local tools."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpecWithHandler] = {}
        self._cache_mtime: float = 0.0
        self._loaded = False

    def _ensure_tools_dir(self) -> None:
        """Ensure the tools directory exists."""
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)

    def _should_refresh_cache(self) -> bool:
        """Check if cache needs refresh based on directory modification time."""
        if not self._loaded:
            return True
        
        if not TOOLS_DIR.exists():
            return False
        
        # Check directory mtime
        mtime = TOOLS_DIR.stat().st_mtime
        if mtime > self._cache_mtime:
            return True
        
        # Check individual file mtimes
        for py_file in TOOLS_DIR.glob("*.py"):
            if py_file.stat().st_mtime > self._cache_mtime:
                return True
        
        return False

    def _load_module(self, file_path: Path) -> Any:
        """Dynamically load a Python module from a file path."""
        module_name = f"copilot_web_tools.{file_path.stem}"
        
        # Remove from sys.modules if already loaded (for reloading)
        if module_name in sys.modules:
            del sys.modules[module_name]
        
        spec = importlib.util.spec_from_file_location(module_name, file_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not load module spec from {file_path}")
        
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        
        return module

    def _validate_tool_spec(self, spec: dict, source_file: str) -> bool:
        """Validate a tool spec has all required keys."""
        required_keys = ["name", "description", "parameters", "handler"]
        
        for key in required_keys:
            if key not in spec:
                logger.warning(f"Tool spec in {source_file} missing required key: {key}")
                return False
        
        if not isinstance(spec["name"], str):
            logger.warning(f"Tool spec in {source_file} has non-string name")
            return False
        
        if not isinstance(spec["description"], str):
            logger.warning(f"Tool spec in {source_file} has non-string description")
            return False
        
        if not isinstance(spec["parameters"], dict):
            logger.warning(f"Tool spec in {source_file} has non-dict parameters")
            return False
        
        if not callable(spec["handler"]):
            logger.warning(f"Tool spec in {source_file} has non-callable handler")
            return False
        
        return True

    def _load_tools_from_file(self, file_path: Path) -> list[ToolSpecWithHandler]:
        """Load tools from a single Python file."""
        tools: list[ToolSpecWithHandler] = []
        
        try:
            module = self._load_module(file_path)
            
            # Check for TOOL_SPECS
            if not hasattr(module, "TOOL_SPECS"):
                logger.debug(f"Module {file_path} has no TOOL_SPECS, skipping")
                return tools
            
            tool_specs = getattr(module, "TOOL_SPECS")
            if not isinstance(tool_specs, list):
                logger.warning(f"TOOL_SPECS in {file_path} is not a list, skipping")
                return tools
            
            for spec in tool_specs:
                if not isinstance(spec, dict):
                    logger.warning(f"Tool spec in {file_path} is not a dict, skipping")
                    continue
                
                if not self._validate_tool_spec(spec, str(file_path)):
                    continue
                
                tool = ToolSpecWithHandler(
                    name=spec["name"],
                    description=spec["description"],
                    parameters=spec["parameters"],
                    handler=spec["handler"],
                    source_file=str(file_path),
                )
                tools.append(tool)
                logger.info(f"Loaded tool: {tool.name} from {file_path.name}")
        
        except Exception as e:
            logger.error(f"Error loading tools from {file_path}: {e}")
        
        return tools

    def load_tools(self, force: bool = False) -> None:
        """Load all tools from the tools directory."""
        self._ensure_tools_dir()
        
        if not force and not self._should_refresh_cache():
            return
        
        logger.info(f"Loading tools from {TOOLS_DIR}")
        self._tools.clear()
        
        if not TOOLS_DIR.exists():
            self._loaded = True
            return
        
        # Load all .py files
        for py_file in sorted(TOOLS_DIR.glob("*.py")):
            if py_file.name.startswith("_"):
                continue
            
            tools = self._load_tools_from_file(py_file)
            for tool in tools:
                if tool.name in self._tools:
                    logger.warning(f"Duplicate tool name '{tool.name}', keeping first definition")
                    continue
                self._tools[tool.name] = tool
        
        self._cache_mtime = max(
            [TOOLS_DIR.stat().st_mtime] + 
            [f.stat().st_mtime for f in TOOLS_DIR.glob("*.py")]
        ) if TOOLS_DIR.exists() else 0.0
        self._loaded = True
        
        logger.info(f"Loaded {len(self._tools)} tools")

    def get_tools_config(self) -> ToolsConfig:
        """Get all loaded tools (without handlers)."""
        self.load_tools()
        
        tools = [
            ToolInfo(
                name=t.name,
                description=t.description,
                parameters=t.parameters,
                source_file=t.source_file,
            )
            for t in self._tools.values()
        ]
        
        return ToolsConfig(tools=tools)

    def get_tool(self, name: str) -> ToolInfo | None:
        """Get a single tool by name."""
        self.load_tools()
        
        tool = self._tools.get(name)
        if not tool:
            return None
        
        return ToolInfo(
            name=tool.name,
            description=tool.description,
            parameters=tool.parameters,
            source_file=tool.source_file,
        )

    def get_tool_handler(self, name: str) -> Callable[..., Any] | None:
        """Get a tool's handler function."""
        self.load_tools()
        
        tool = self._tools.get(name)
        return tool.handler if tool else None

    def execute_tool(self, name: str, arguments: dict, context: dict | None = None) -> ToolResult:
        """Execute a tool with the given arguments."""
        self.load_tools()
        
        tool = self._tools.get(name)
        if not tool:
            return ToolResult(
                result_type="failure",
                text_result_for_llm=f"Tool '{name}' not found",
                error=f"Tool '{name}' not found",
            )
        
        try:
            handler = tool.handler
            
            # Check if handler accepts context parameter
            sig = inspect.signature(handler)
            handler_params = sig.parameters
            
            if "context" in handler_params and context is not None:
                result = handler(**arguments, context=context)
            else:
                result = handler(**arguments)
            
            # Normalize result
            if isinstance(result, str):
                text_result = result
            else:
                text_result = json.dumps(result, indent=2, default=str)
            
            return ToolResult(
                result_type="success",
                text_result_for_llm=text_result,
            )
        
        except TypeError as e:
            # Missing or unexpected arguments
            return ToolResult(
                result_type="failure",
                text_result_for_llm=f"Tool execution failed: {e}",
                error=str(e),
            )
        
        except Exception as e:
            logger.exception(f"Error executing tool {name}")
            return ToolResult(
                result_type="failure",
                text_result_for_llm=f"Tool execution failed: {e}",
                error=str(e),
            )

    def get_tools_for_session(self, selections: list[str] | None = None) -> list[ToolSpecWithHandler]:
        """Get tools filtered by selections.
        
        Args:
            selections: List of enabled tool names. If None, all tools are included.
                       If empty list, no tools are included.
        """
        self.load_tools()
        
        if selections is None:
            return list(self._tools.values())
        
        return [
            tool for name, tool in self._tools.items()
            if name in selections
        ]

    def refresh(self) -> ToolsConfig:
        """Force refresh tools from disk."""
        self.load_tools(force=True)
        return self.get_tools_config()

    def _normalize_tool_return(self, value: Any) -> SDKToolResult:
        """Normalize a tool handler return value to SDK ToolResult format."""
        if value is None:
            return SDKToolResult(textResultForLlm="", resultType="success")

        if isinstance(value, dict) and "resultType" in value and "textResultForLlm" in value:
            # Already a ToolResult-like dict
            return value  # type: ignore[return-value]

        if isinstance(value, str):
            return SDKToolResult(textResultForLlm=value, resultType="success")

        return SDKToolResult(textResultForLlm=json.dumps(value, default=str), resultType="success")

    def _make_sdk_tool(self, spec: ToolSpecWithHandler) -> Tool:
        """Convert a ToolSpecWithHandler to an SDK Tool object.
        
        The SDK tool name is generated as: {filename}_{toolname}
        e.g., for tool "greet" in file "example_tools.py" -> "example_tools_greet"
        
        This ensures unique names and follows the SDK naming pattern: ^[a-zA-Z0-9_-]{1,128}$
        """
        fn = spec.handler
        
        # Generate SDK-compatible name: filename_toolname
        source_path = Path(spec.source_file)
        file_prefix = source_path.stem  # e.g., "example_tools" from "example_tools.py"
        sdk_name = f"{file_prefix}_{spec.name}"

        async def handler(invocation: ToolInvocation) -> SDKToolResult:
            try:
                args = invocation.get("arguments") or {}
                result = fn(**args)

                if inspect.isawaitable(result):
                    result = await result

                return self._normalize_tool_return(result)
            except Exception as exc:
                logger.error(f"Tool {sdk_name} execution error: {exc}")
                return SDKToolResult(
                    textResultForLlm=f"Invoking this tool produced an error: {exc}",
                    resultType="failure",
                    error=str(exc),
                    toolTelemetry={},
                )

        return Tool(
            name=sdk_name,
            description=spec.description,
            parameters=spec.parameters,
            handler=handler,
        )

    def get_sdk_tools(self, selections: list[str] | None = None) -> list[Tool]:
        """Get SDK-compatible Tool objects filtered by selections.
        
        Args:
            selections: List of enabled tool names. If None, all tools are included.
        
        Returns:
            List of copilot.types.Tool objects ready for SDK create_session/resume_session.
        """
        tool_specs = self.get_tools_for_session(selections)
        return [self._make_sdk_tool(spec) for spec in tool_specs]


# Singleton instance
_tools_service: ToolsService | None = None


def get_tools_service() -> ToolsService:
    """Get the singleton tools service instance."""
    global _tools_service
    if _tools_service is None:
        _tools_service = ToolsService()
    return _tools_service
