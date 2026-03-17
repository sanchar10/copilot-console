"""GZip middleware that skips compression for SSE (text/event-stream) responses.

SSE streams must flow unbuffered for real-time delivery.  Standard GZipMiddleware
buffers the entire response before compressing, which breaks streaming.

Approach: we sit in front of GZipMiddleware and peek at the response
Content-Type.  If it's text/event-stream, we run the app directly (bypassing
GZip).  For all other responses, we delegate to GZipMiddleware as usual.
"""

from starlette.types import ASGIApp, Receive, Scope, Send
from fastapi.middleware.gzip import GZipMiddleware


class SelectiveGZipMiddleware:
    """Delegates to GZipMiddleware for normal responses, bypasses it for SSE."""

    def __init__(self, app: ASGIApp, minimum_size: int = 1000) -> None:
        self.app = app
        self.gzip_app = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if self._is_likely_sse(scope):
            # Bypass GZip entirely for SSE endpoints
            await self.app(scope, receive, send)
        else:
            # Use GZip for everything else
            await self.gzip_app(scope, receive, send)

    @staticmethod
    def _is_likely_sse(scope: Scope) -> bool:
        """Check if this request is likely an SSE endpoint.
        
        Uses the Accept header (set by EventSource) and known SSE path patterns.
        This avoids the impossible problem of needing to peek at the response
        Content-Type before choosing the middleware path.
        """
        # Check Accept header (EventSource sends Accept: text/event-stream)
        for name, value in scope.get("headers", []):
            if name == b"accept":
                if b"text/event-stream" in value:
                    return True
                break

        # Check path for known SSE endpoints (POST /messages returns SSE,
        # GET /stream, /resume-stream)
        path = scope.get("path", "")
        if path.endswith("/messages") and scope.get("method") == "POST":
            return True
        if "/stream" in path or "/resume-stream" in path:
            return True

        return False

