from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.cors import CORSMiddleware
import socketio
import logging
import os

from app.api.routes import auth, admin, translate, settings_public, billing, suggestions
from app.api.websockets import sio
from app.db.base import Base
from app.db.session import engine, get_db
from app.db.sqlite_compat import ensure_user_table_columns, ensure_system_settings_columns
from sqlalchemy.orm import Session
from app.core.limiter import limiter
from app.models.user import User  # Importar para que Base conozca la tabla
from app.models.system_settings import SystemSettings  # tabla system_settings
from app.models.suggestion import Suggestion  # noqa: F401 — tabla suggestions
from app.models.admin_audit_log import AdminAuditLog  # noqa: F401 — tabla admin_audit_log

_log = logging.getLogger("uvicorn.error")

# Crear tablas en SQLite si no existen + alinear columnas si el modelo creció
Base.metadata.create_all(bind=engine)
ensure_user_table_columns(engine)
ensure_system_settings_columns(engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        if db.get(SystemSettings, 1) is None:
            db.add(SystemSettings(id=1, nsfw_global_intensity=50))
            db.commit()
    finally:
        db.close()
    _log.warning("[albedrio] API lista — prueba: GET /health y GET /api/health en el puerto donde corre uvicorn")
    yield


app = FastAPI(title="Albedrío API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Rutas REST antes del wrapper Socket.IO (mismo objeto `app`).
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(settings_public.router, prefix="/api/settings", tags=["settings"])
app.include_router(translate.router, prefix="/api", tags=["translate"])
app.include_router(billing.router, prefix="/api/billing", tags=["billing"])
app.include_router(suggestions.router, prefix="/api/suggestions", tags=["suggestions"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "Albedrío API is running"}


def _health_payload(db_ok: bool) -> dict:
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "ometv-api",
        "database": "ok" if db_ok else "unavailable",
    }


@app.get("/health")
def health_short(db: Session = Depends(get_db)):
    """Alias corto: si /api/health da 404, prueba esta URL en el mismo puerto."""
    try:
        db.execute(text("SELECT 1"))
        ok = True
    except Exception:
        ok = False
    body = {**_health_payload(ok), "route": "/health"}
    if not ok:
        return JSONResponse(status_code=503, content=body)
    return body


@app.get("/api/health")
def api_health(db: Session = Depends(get_db)):
    """Comprueba proceso + conexión a base de datos."""
    try:
        db.execute(text("SELECT 1"))
        ok = True
    except Exception:
        ok = False
    body = {**_health_payload(ok), "route": "/api/health"}
    if not ok:
        return JSONResponse(status_code=503, content=body)
    return body


# ASGI: Socket.IO + FastAPI. CORS debe envolver el árbol COMPLETO; si solo está en FastAPI, algunas
# respuestas (p. ej. errores en el puente ASGI) no llevan Access-Control-Allow-Origin.
_mount = socketio.ASGIApp(sio, app)

_extra_origins = [
    o.strip()
    for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",")
    if o.strip()
]
_allow_origins = [
    "https://albedrio-web.onrender.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    *_extra_origins,
]

application = CORSMiddleware(
    _mount,
    allow_origins=_allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    # Cualquier subdominio onrender.com (previews / renombres).
    allow_origin_regex=r"https://[a-z0-9\-]+\.onrender\.com$",
)
socket_app = application
