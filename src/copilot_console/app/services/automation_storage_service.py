"""Automation storage service for CRUD operations on automations.

Stores automation definitions as JSON files in ~/.copilot-console/automations/.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from copilot_console.app.config import AUTOMATIONS_DIR, ensure_directories
from copilot_console.app.models.automation import Automation, AutomationCreate, AutomationUpdate
from copilot_console.app.services.storage_service import atomic_write


class AutomationStorageService:
    """Handles automation persistence."""

    def __init__(self) -> None:
        ensure_directories()

    def _automation_file(self, automation_id: str) -> Path:
        return AUTOMATIONS_DIR / f"{automation_id}.json"

    def save_automation(self, automation: Automation) -> None:
        """Save an automation to disk."""
        data = automation.model_dump()
        data["created_at"] = automation.created_at.isoformat()
        data["updated_at"] = automation.updated_at.isoformat()
        atomic_write(
            self._automation_file(automation.id),
            json.dumps(data, indent=2, default=str),
        )

    def load_automation(self, automation_id: str) -> Automation | None:
        """Load an automation by ID."""
        f = self._automation_file(automation_id)
        if not f.exists():
            return None
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            return Automation(**data)
        except (json.JSONDecodeError, IOError, ValueError):
            return None

    def list_automations(self) -> list[Automation]:
        """List all automations."""
        automations = []
        if AUTOMATIONS_DIR.exists():
            for f in sorted(AUTOMATIONS_DIR.glob("*.json")):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                    automations.append(Automation(**data))
                except (json.JSONDecodeError, IOError, ValueError):
                    pass
        return automations

    def create_automation(self, request: AutomationCreate) -> Automation:
        """Create a new automation."""
        now = datetime.now(timezone.utc)
        automation = Automation(
            id=str(uuid.uuid4())[:8],
            created_at=now,
            updated_at=now,
            **request.model_dump(),
        )
        self.save_automation(automation)
        return automation

    def update_automation(self, automation_id: str, request: AutomationUpdate) -> Automation | None:
        """Update an automation. Returns None if not found."""
        automation = self.load_automation(automation_id)
        if not automation:
            return None
        update_data = request.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(automation, field, value)
        automation.updated_at = datetime.now(timezone.utc)
        self.save_automation(automation)
        return automation

    def delete_automation(self, automation_id: str) -> bool:
        """Delete an automation. Returns True if deleted."""
        f = self._automation_file(automation_id)
        if not f.exists():
            return False
        f.unlink()
        return True


# Singleton instance
automation_storage_service = AutomationStorageService()
