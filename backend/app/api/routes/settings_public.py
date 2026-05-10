from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.system_settings import SystemSettings
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
