"""Stripe Checkout (suscripción mensual) y webhooks."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.websockets import online_users, sio
from app.core.config import settings
from app.db.session import get_db
from app.models.system_settings import SystemSettings
from app.models.user import User
from app.schemas.billing import BillingStatusOut, CheckoutSessionOut, PortalSessionOut
from app.services.premium import (
    apply_premium_active,
    clear_premium,
    premium_status_dict,
    user_has_premium,
)

_log = logging.getLogger("uvicorn.error")
router = APIRouter()


def _stripe_ready() -> bool:
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID)


def _configure_stripe() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Pagos no configurados en el servidor")
    stripe.api_key = settings.STRIPE_SECRET_KEY


def _get_settings_row(db: Session) -> SystemSettings:
    row = db.get(SystemSettings, 1)
    if row is None:
        row = SystemSettings(id=1, nsfw_global_intensity=50, payments_enabled=False)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _payments_enabled(db: Session) -> bool:
    return bool(_get_settings_row(db).payments_enabled)


async def _emit_premium_updated(user: User) -> None:
    payload = {"user_id": user.id, **premium_status_dict(user)}
    for sid, info in list(online_users.items()):
        uid = info.get("user_id")
        try:
            if uid is not None and int(uid) == int(user.id):
                await sio.emit("premium_updated", payload, to=str(sid))
        except (TypeError, ValueError):
            continue


def _sync_user_from_subscription(user: User, sub: stripe.Subscription) -> None:
    status = getattr(sub, "status", None) or sub.get("status")
    period_end = sub.get("current_period_end") if isinstance(sub, dict) else getattr(sub, "current_period_end", None)
    until = (
        datetime.fromtimestamp(int(period_end), tz=timezone.utc) if period_end else None
    )
    user.stripe_subscription_id = sub.get("id") if isinstance(sub, dict) else sub.id
    if status in ("active", "trialing"):
        apply_premium_active(user, source="stripe", until=until)
    else:
        clear_premium(user)


@router.get("/status", response_model=BillingStatusOut)
def billing_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enabled = _payments_enabled(db)
    return BillingStatusOut(
        is_premium=user_has_premium(current_user),
        premium_source=getattr(current_user, "premium_source", None),
        premium_until=getattr(current_user, "premium_until", None),
        payments_enabled=enabled,
        can_subscribe=enabled
        and _stripe_ready()
        and not current_user.is_anonymous
        and not user_has_premium(current_user),
    )


@router.post("/create-checkout-session", response_model=CheckoutSessionOut)
def create_checkout_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _payments_enabled(db):
        raise HTTPException(status_code=403, detail="Los pagos están desactivados")
    if current_user.is_anonymous:
        raise HTTPException(
            status_code=400,
            detail="Crea una cuenta (Google o registro) para suscribirte a Premium",
        )
    if user_has_premium(current_user):
        raise HTTPException(status_code=400, detail="Ya tienes Premium activo")
    if not _stripe_ready():
        raise HTTPException(status_code=503, detail="Stripe no está configurado")

    _configure_stripe()

    if not current_user.stripe_customer_id:
        customer = stripe.Customer.create(
            email=current_user.email,
            name=current_user.display_name or f"Usuario {current_user.id}",
            metadata={"user_id": str(current_user.id)},
        )
        current_user.stripe_customer_id = customer.id
        db.commit()
        db.refresh(current_user)

    base = settings.frontend_base_url.rstrip("/")
    checkout_kw = dict(
        mode="subscription",
        customer=current_user.stripe_customer_id,
        line_items=[{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
        success_url=f"{base}/premium?success=1",
        cancel_url=f"{base}/premium?canceled=1",
        client_reference_id=str(current_user.id),
        metadata={"user_id": str(current_user.id)},
    )
    try:
        session = stripe.checkout.Session.create(**checkout_kw, adaptive_pricing={"enabled": True})
    except stripe.error.InvalidRequestError:
        session = stripe.checkout.Session.create(**checkout_kw)
    if not session.url:
        raise HTTPException(status_code=502, detail="No se pudo crear la sesión de pago")
    return CheckoutSessionOut(url=session.url)


@router.post("/create-portal-session", response_model=PortalSessionOut)
def create_portal_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_anonymous or not current_user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No hay suscripción Stripe asociada")
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe no está configurado")

    _configure_stripe()
    base = settings.frontend_base_url.rstrip("/")
    portal = stripe.billing_portal.Session.create(
        customer=current_user.stripe_customer_id,
        return_url=f"{base}/premium",
    )
    return PortalSessionOut(url=portal.url)


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not settings.STRIPE_WEBHOOK_SECRET or not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Webhook no configurado")

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Payload inválido") from exc
    except stripe.error.SignatureVerificationError as exc:
        raise HTTPException(status_code=400, detail="Firma inválida") from exc

    etype = event["type"]
    data = event["data"]["object"]

    user: User | None = None

    if etype == "checkout.session.completed":
        uid = data.get("client_reference_id") or (data.get("metadata") or {}).get("user_id")
        sub_id = data.get("subscription")
        customer_id = data.get("customer")
        if uid:
            try:
                user = db.get(User, int(uid))
            except (TypeError, ValueError):
                user = None
            if user:
                if customer_id:
                    user.stripe_customer_id = customer_id
                if sub_id:
                    user.stripe_subscription_id = sub_id
                    _configure_stripe()
                    sub = stripe.Subscription.retrieve(sub_id)
                    _sync_user_from_subscription(user, sub)

    elif etype in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub_id = data.get("id")
        customer_id = data.get("customer")
        user = (
            db.query(User).filter(User.stripe_subscription_id == sub_id).first()
            if sub_id
            else None
        )
        if user is None and customer_id:
            user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user:
            if etype == "customer.subscription.deleted":
                clear_premium(user)
                user.stripe_subscription_id = None
            else:
                _sync_user_from_subscription(user, data)

    elif etype == "invoice.paid":
        sub_id = data.get("subscription")
        if sub_id:
            user = db.query(User).filter(User.stripe_subscription_id == sub_id).first()
            if user:
                period_end = data.get("lines", {}).get("data", [{}])[0].get("period", {}).get("end")
                if period_end:
                    until = datetime.fromtimestamp(int(period_end), tz=timezone.utc)
                    apply_premium_active(user, source="stripe", until=until)

    if user is not None:
        db.commit()
        db.refresh(user)
        await _emit_premium_updated(user)
        _log.info("[billing] user %s premium=%s source=%s", user.id, user.is_premium, user.premium_source)

    return {"received": True}
