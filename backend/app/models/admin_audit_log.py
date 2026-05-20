"""Registro append-only de acciones sensibles del panel admin."""
import json
from typing import Any

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func

from app.db.base import Base


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(64), nullable=False, index=True)
    target_user_id = Column(Integer, nullable=True, index=True)
    detail = Column(Text, nullable=True)
    ip = Column(String(128), nullable=True)


def log_admin_action(
    db,
    *,
    actor: Any,
    action: str,
    target_user_id: int | None = None,
    detail: dict | None = None,
    client_ip: str | None = None,
) -> None:
    """Persiste una fila de auditoría (llamar dentro de la misma transacción o commit aparte)."""
    row = AdminAuditLog(
        actor_user_id=int(actor.id),
        action=action[:64],
        target_user_id=target_user_id,
        detail=json.dumps(detail, ensure_ascii=False)[:8000] if detail else None,
        ip=(client_ip or "")[:128] or None,
    )
    db.add(row)


def audit_client_ip(request) -> str | None:
    if request is None:
        return None
    xf = request.headers.get("x-forwarded-for")
    if xf:
        return xf.split(",")[0].strip()[:128] or None
    if request.client:
        return request.client.host[:128]
    return None
