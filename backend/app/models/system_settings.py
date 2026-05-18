"""Configuración global de la aplicación (una fila, id fijo)."""
from sqlalchemy import Column, Integer, Boolean

from app.db.base import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True)
    nsfw_global_intensity = Column(Integer, nullable=False, default=50)
    payments_enabled = Column(Boolean, nullable=False, default=False)
