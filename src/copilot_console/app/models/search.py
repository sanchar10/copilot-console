"""Search models."""

from __future__ import annotations

from pydantic import BaseModel


class SearchSnippet(BaseModel):
    """A matching message snippet within a session."""

    content: str
    message_role: str  # "user" or "assistant"
    sdk_message_id: str | None = None
    timestamp: str | None = None


class SearchResult(BaseModel):
    """A session that matched the search query."""

    session_id: str
    session_name: str
    match_type: str  # "name", "content", or "both"
    snippets: list[SearchSnippet] = []
    last_active: float  # Unix timestamp for sorting
    trigger: str | None = None  # 'workflow' | 'automation' | 'help' | None — for client-side filtering
