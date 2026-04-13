"""Filesystem router - browse directories and open files."""

import ctypes
import os
import platform
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/filesystem", tags=["filesystem"])


@router.get("/browse")
async def browse_directory(path: str | None = Query(None, description="Directory path to list. None returns root/drives.")) -> dict:
    """Browse a directory and return its subdirectories.
    
    On Windows with no path: returns available drive letters.
    On Unix with no path: returns contents of /.
    With a path: returns subdirectories of that path.
    """
    try:
        # No path provided - return root entries
        if not path:
            if platform.system() == "Windows":
                # Use GetLogicalDrives bitmask for reliable drive detection
                drives = []
                bitmask = ctypes.windll.kernel32.GetLogicalDrives()  # type: ignore[attr-defined]
                for i in range(26):
                    if bitmask & (1 << i):
                        letter = chr(ord('A') + i)
                        drive_path = f"{letter}:\\"
                        drives.append({
                            "name": f"{letter}:",
                            "path": drive_path,
                            "is_drive": True,
                        })
                return {
                    "current_path": "",
                    "parent_path": None,
                    "entries": drives,
                }
            else:
                # Unix - start at root
                path = "/"

        # Resolve and validate the path
        target = Path(path).resolve()
        
        if not target.exists():
            raise HTTPException(status_code=404, detail=f"Path does not exist: {path}")
        
        if not target.is_dir():
            raise HTTPException(status_code=400, detail=f"Path is not a directory: {path}")

        # Determine parent path
        parent_path: str | None = None
        if platform.system() == "Windows":
            # On Windows, parent of a drive root (e.g., C:\) goes back to drive list
            # Use target.parent == target which is True at drive roots
            if target.parent == target:
                parent_path = ""  # empty string means "go to drive list"
            else:
                parent_path = str(target.parent)
        else:
            if str(target) == "/":
                parent_path = None  # Already at root
            else:
                parent_path = str(target.parent)

        # List subdirectories
        entries = []
        try:
            for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
                if entry.is_dir():
                    # Skip hidden directories and common uninteresting dirs
                    name = entry.name
                    if name.startswith('.') and name not in ('.', '..'):
                        continue
                    try:
                        # Check if we can actually access this directory
                        list(entry.iterdir())
                        accessible = True
                    except PermissionError:
                        accessible = False
                    except OSError:
                        accessible = False
                    
                    entries.append({
                        "name": name,
                        "path": str(entry),
                        "accessible": accessible,
                    })
        except PermissionError:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {path}"
            )
        except OSError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error reading directory: {e}"
            )

        return {
            "current_path": str(target),
            "parent_path": parent_path,
            "entries": entries,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


class OpenFileRequest(BaseModel):
    path: str


class OpenWithRequest(BaseModel):
    cwd: str
    target: str  # 'vscode' | 'terminal' | 'explorer'


@router.post("/open-with")
async def open_with(request: OpenWithRequest) -> dict:
    """Open a folder in VS Code, Terminal, or File Explorer."""
    cwd = Path(request.cwd)
    if not cwd.exists() or not cwd.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")

    system = platform.system()
    try:
        if request.target == "vscode":
            # Use shell=True on Windows so it finds code.cmd via PATH
            if system == "Windows":
                subprocess.Popen(f'code "{cwd}"', shell=True)
            else:
                subprocess.Popen(["code", str(cwd)])
        elif request.target == "terminal":
            if system == "Windows":
                import shutil
                shell = shutil.which("pwsh") or shutil.which("powershell") or "cmd"
                if "pwsh" in shell or "powershell" in shell:
                    subprocess.Popen([shell, "-NoExit", "-Command", f"Set-Location '{cwd}'"],
                                     creationflags=subprocess.CREATE_NEW_CONSOLE)
                else:
                    subprocess.Popen(["cmd", "/k", f"cd /d {cwd}"],
                                     creationflags=subprocess.CREATE_NEW_CONSOLE)
            elif system == "Darwin":
                subprocess.Popen(["open", "-a", "Terminal", str(cwd)])
            else:
                subprocess.Popen(["x-terminal-emulator", "--working-directory", str(cwd)])
        elif request.target == "explorer":
            if system == "Windows":
                subprocess.Popen(["explorer", str(cwd)])
            elif system == "Darwin":
                subprocess.Popen(["open", str(cwd)])
            else:
                subprocess.Popen(["xdg-open", str(cwd)])
        else:
            raise HTTPException(status_code=400, detail=f"Unknown target: {request.target}")
        return {"status": "opened", "target": request.target, "cwd": str(cwd)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"'{request.target}' not found — is it installed?")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open: {e}")


@router.post("/open")
async def open_file(request: OpenFileRequest) -> dict:
    """Open a file with the OS default application."""
    file_path = Path(request.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")

    try:
        system = platform.system()
        if system == "Windows":
            if file_path.is_dir():
                subprocess.Popen(["explorer", str(file_path)])
            else:
                os.startfile(str(file_path))  # type: ignore[attr-defined]
        elif system == "Darwin":
            subprocess.Popen(["open", str(file_path)])
        else:
            subprocess.Popen(["xdg-open", str(file_path)])
        return {"status": "opened", "path": str(file_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open file: {e}")
