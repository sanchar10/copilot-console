"""API endpoints for per-session message pins."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from copilot_console.app.models.pin import Pin, PinCreate, PinUpdate
from copilot_console.app.services.pin_storage_service import pin_storage_service

router = APIRouter(prefix="/sessions/{session_id}/pins", tags=["pins"])


@router.get("")
async def list_pins(session_id: str) -> dict[str, list[Pin]]:
    pins = pin_storage_service.list_pins(session_id)
    return {"pins": pins}


@router.post("")
async def create_pin(session_id: str, req: PinCreate) -> Pin:
    if not req.sdk_message_id:
        raise HTTPException(status_code=400, detail="sdk_message_id is required")
    return pin_storage_service.create_pin(session_id, req)


@router.patch("/{pin_id}")
async def update_pin(session_id: str, pin_id: str, req: PinUpdate) -> Pin:
    updated = pin_storage_service.update_pin(session_id, pin_id, req)
    if updated is None:
        raise HTTPException(status_code=404, detail="Pin not found")
    return updated


@router.delete("/{pin_id}")
async def delete_pin(session_id: str, pin_id: str) -> dict:
    deleted = pin_storage_service.delete_pin(session_id, pin_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Pin not found")
    return {"success": True}
