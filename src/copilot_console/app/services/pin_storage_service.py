"""Filesystem-backed storage for per-session message pins."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from copilot_console.app.config import SESSIONS_DIR, ensure_directories
from copilot_console.app.models.pin import Pin, PinCreate, PinUpdate


class PinStorageService:
    def __init__(self) -> None:
        ensure_directories()

    def _session_dir(self, session_id: str) -> Path:
        return SESSIONS_DIR / session_id

    def _pins_file(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "pins.json"

    def _read_pins(self, session_id: str) -> list[dict]:
        path = self._pins_file(session_id)
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
            return []
        except (OSError, json.JSONDecodeError):
            return []

    def _write_pins(self, session_id: str, pins: list[dict]) -> None:
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        path = self._pins_file(session_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(pins, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)

    def list_pins(self, session_id: str) -> list[Pin]:
        pins_raw = self._read_pins(session_id)
        pins: list[Pin] = []
        for item in pins_raw:
            try:
                pins.append(Pin.model_validate(item))
            except Exception:
                continue
        pins.sort(key=lambda p: p.created_at)
        return pins

    def create_pin(self, session_id: str, req: PinCreate) -> Pin:
        now = datetime.now(timezone.utc)
        pin = Pin(
            id=f"pin_{uuid4().hex}",
            session_id=session_id,
            sdk_message_id=req.sdk_message_id,
            created_at=now,
            updated_at=now,
            title=req.title,
            excerpt=req.excerpt,
            note=req.note,
            tags=req.tags,
        )
        pins = self._read_pins(session_id)
        pins.append(pin.model_dump())
        self._write_pins(session_id, pins)
        return pin

    def update_pin(self, session_id: str, pin_id: str, req: PinUpdate) -> Pin | None:
        pins = self._read_pins(session_id)
        updated: Pin | None = None
        for i, item in enumerate(pins):
            if not isinstance(item, dict) or item.get("id") != pin_id:
                continue
            try:
                current = Pin.model_validate(item)
            except Exception:
                return None

            patch = req.model_dump(exclude_unset=True)
            new_data = current.model_dump()
            for k, v in patch.items():
                if v is not None:
                    new_data[k] = v
            new_data["updated_at"] = datetime.now(timezone.utc)
            updated = Pin.model_validate(new_data)
            pins[i] = updated.model_dump()
            break

        if updated is None:
            return None
        self._write_pins(session_id, pins)
        return updated

    def delete_pin(self, session_id: str, pin_id: str) -> bool:
        pins = self._read_pins(session_id)
        new_pins = [p for p in pins if isinstance(p, dict) and p.get("id") != pin_id]
        if len(new_pins) == len(pins):
            return False
        self._write_pins(session_id, new_pins)
        return True


pin_storage_service = PinStorageService()
