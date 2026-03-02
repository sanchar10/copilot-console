"""Message models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MessageStep(BaseModel):
    """A step in the assistant's response (tool call, reasoning, etc.)."""

    title: str
    detail: str | None = None


class MessageAttachment(BaseModel):
    """Attachment on a message (from SDK history)."""

    type: str = "file"
    path: str | None = None
    displayName: str | None = None


class Message(BaseModel):
    """Chat message."""

    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime
    steps: list[MessageStep] | None = None
    attachments: list[MessageAttachment] | None = None


class AttachmentRef(BaseModel):
    """Reference to an uploaded file for SDK attachment."""

    type: Literal["file", "directory"] = "file"
    path: str
    displayName: str | None = None


class MessageCreate(BaseModel):
    """Request to send a message."""

    content: str = Field(..., min_length=0)
    is_new_session: bool = False  # True if this is the first message in a new session
    mode: Literal["enqueue", "immediate"] | None = None  # Message delivery mode
    attachments: list[AttachmentRef] | None = None  # File/directory attachments
    agent_mode: str | None = None  # Agent mode to set before sending (interactive/plan/autopilot)


class MessageDelta(BaseModel):
    """Streaming message delta."""

    content: str


class MessageComplete(BaseModel):
    """Message completion event."""

    message_id: str
