"""Pin models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Pin(BaseModel):
    """A durable per-session pin anchored to an SDK message id."""

    id: str
    session_id: str
    sdk_message_id: str
    created_at: datetime
    updated_at: datetime
    title: str | None = None
    excerpt: str | None = None
    note: str | None = None
    tags: list[str] | None = None


class PinCreate(BaseModel):
    """Request to create a pin."""

    sdk_message_id: str = Field(..., min_length=1)
    title: str | None = None
    excerpt: str | None = None
    note: str | None = None
    tags: list[str] | None = None


class PinUpdate(BaseModel):
    """Request to update mutable pin fields."""

    title: str | None = None
    excerpt: str | None = None
    note: str | None = None
    tags: list[str] | None = None
