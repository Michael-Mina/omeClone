"""Estado premium del usuario (Stripe, admin o expiración)."""
from __future__ import annotations

from datetime import datetime, timezone

from app.models.user import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def user_has_premium(user: User) -> bool:
    if not bool(getattr(user, "is_premium", False)):
        return False
    until = _aware(getattr(user, "premium_until", None))
    if until is None:
        return True
    return until > _utcnow()


def apply_premium_active(
    user: User,
    *,
    source: str,
    until: datetime | None = None,
) -> None:
    user.is_premium = True
    user.premium_source = source
    user.premium_until = until


def clear_premium(user: User) -> None:
    user.is_premium = False
    user.premium_source = None
    user.premium_until = None


def premium_status_dict(user: User) -> dict:
    active = user_has_premium(user)
    until = _aware(getattr(user, "premium_until", None))
    return {
        "is_premium": active,
        "premium_source": getattr(user, "premium_source", None),
        "premium_until": until.isoformat() if until else None,
    }
