from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class BillingPublicOut(BaseModel):
    payments_enabled: bool
    stripe_publishable_key: Optional[str] = None
    stripe_configured: bool


class BillingStatusOut(BaseModel):
    is_premium: bool
    premium_source: Optional[str] = None
    premium_until: Optional[datetime] = None
    payments_enabled: bool
    can_subscribe: bool


class CheckoutSessionOut(BaseModel):
    url: str


class PortalSessionOut(BaseModel):
    url: str


class BillingSettingsPatch(BaseModel):
    payments_enabled: bool


class BillingSettingsOut(BaseModel):
    payments_enabled: bool
    stripe_configured: bool


class AdminPremiumPatch(BaseModel):
    enabled: bool
