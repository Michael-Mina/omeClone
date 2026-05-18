from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.system_settings import SystemSettings
from app.schemas.billing import BillingPublicOut
from app.services.nsfw_client_params import intensity_to_client_params

router = APIRouter()


@router.get("/nsfw-detection")
def get_public_nsfw_detection_settings(db: Session = Depends(get_db)):
    """
    Sin autenticación: parámetros actuales para el modelo NSFW en el cliente.
    Los usuarios con exención individual no aplican estos valores (omitir modelo).
    """
    row = db.get(SystemSettings, 1)
    intensity = int(row.nsfw_global_intensity) if row else 50
    return intensity_to_client_params(intensity).as_dict()


@router.get("/billing", response_model=BillingPublicOut)
def get_public_billing_settings(db: Session = Depends(get_db)):
    row = db.get(SystemSettings, 1)
    enabled = bool(getattr(row, "payments_enabled", False)) if row else False
    configured = bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID)
    return BillingPublicOut(
        payments_enabled=enabled and configured,
        stripe_publishable_key=settings.STRIPE_PUBLISHABLE_KEY,
        stripe_configured=configured,
    )
