"""Tests for the optional install-command detection in /api/features."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

from copilot_console.app.main import _build_install_command


def _patch_exec(path: str):
    return patch.object(sys, "executable", path)


def test_pipx_detection_via_path_unix():
    with _patch_exec("/home/alice/.local/share/pipx/venvs/copilot-console/bin/python"):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PIPX_HOME", None)
            assert _build_install_command() == (
                'pipx inject copilot-console agent-framework --pip-args="--pre"'
            )


def test_pipx_detection_via_path_windows():
    with _patch_exec(r"C:\Users\alice\pipx\venvs\copilot-console\Scripts\python.exe"):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PIPX_HOME", None)
            assert _build_install_command() == (
                'pipx inject copilot-console agent-framework --pip-args="--pre"'
            )


def test_pipx_detection_via_env_var(tmp_path: Path):
    pipx_home = tmp_path / "custom-pipx"
    venv_python = pipx_home / "venvs" / "copilot-console" / "bin" / "python"
    venv_python.parent.mkdir(parents=True)
    venv_python.touch()
    with _patch_exec(str(venv_python)):
        with patch.dict(os.environ, {"PIPX_HOME": str(pipx_home)}):
            assert _build_install_command() == (
                'pipx inject copilot-console agent-framework --pip-args="--pre"'
            )


def test_regular_pip_unix():
    with _patch_exec("/home/alice/.venv/bin/python"):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PIPX_HOME", None)
            with patch.object(sys, "platform", "linux"):
                assert _build_install_command() == (
                    "python3 -m pip install agent-framework --pre"
                )


def test_regular_pip_windows():
    with _patch_exec(r"C:\Users\alice\.venv\Scripts\python.exe"):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PIPX_HOME", None)
            with patch.object(sys, "platform", "win32"):
                assert _build_install_command() == (
                    "python -m pip install agent-framework --pre"
                )
