"""API endpoint for full-text search across sessions."""

from __future__ import annotations

from fastapi import APIRouter, Query

from copilot_console.app.models.search import SearchResult
from copilot_console.app.services import search_service
from copilot_console.app.services.session_service import session_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def search_sessions(q: str = Query(..., min_length=2)) -> dict[str, list[SearchResult]]:
    """Search across session names and message content."""
    sessions = await session_service.list_sessions()
    results = await search_service.search(q, sessions)
    return {"results": results}
