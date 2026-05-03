"""POST /api/help/ask — answer questions about Copilot Console using the bundled docs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from copilot_console.app.services import help_service

router = APIRouter(prefix="/help", tags=["help"])


class HelpRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)


class HelpResponse(BaseModel):
    answer: str
    session_id: str


@router.post("/ask", response_model=HelpResponse)
async def ask(request: HelpRequest) -> HelpResponse:
    try:
        result = await help_service.ask_help(request.question)
        return HelpResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
