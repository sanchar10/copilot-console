"""Copilot Console - A feature-rich console for GitHub Copilot agents."""

from importlib.metadata import version as _pkg_version, PackageNotFoundError

try:
    __version__ = _pkg_version("copilot-console")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"

__app_name__ = "Copilot Console"
