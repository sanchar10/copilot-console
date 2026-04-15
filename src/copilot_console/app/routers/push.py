"""Push notification routes — subscription management and VAPID key endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from copilot_console.app.services.push_service import (
    get_or_create_vapid_keys,
    push_subscription_service,
)

router = APIRouter(prefix="/push", tags=["push"])


class PushSubscription(BaseModel):
    """Web Push subscription from browser."""
    endpoint: str
    keys: dict  # p256dh + auth


class UnsubscribeRequest(BaseModel):
    """Request to remove a push subscription."""
    endpoint: str


@router.get("/vapid-key")
async def get_vapid_public_key() -> dict:
    """Get the VAPID public key for push notification subscription."""
    keys = get_or_create_vapid_keys()
    return {"public_key": keys["vapid_public_key"]}


@router.post("/subscribe")
async def subscribe(subscription: PushSubscription) -> dict:
    """Register a device for push notifications."""
    push_subscription_service.subscribe(subscription.model_dump())
    return {"status": "subscribed"}


@router.get("/subscriptions")
async def list_subscriptions() -> dict:
    """List all registered push notification subscriptions."""
    subs = push_subscription_service.get_all()
    return {
        "subscriptions": [
            {"endpoint": s.get("endpoint", "")} for s in subs
        ],
    }


@router.delete("/subscribe")
async def unsubscribe(request: UnsubscribeRequest) -> dict:
    """Remove a device's push notification subscription."""
    removed = push_subscription_service.unsubscribe(request.endpoint)
    return {"status": "unsubscribed" if removed else "not_found"}
