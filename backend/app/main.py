from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
import socketio
import logging
import os

from app.api.routes import auth, admin, translate, settings_public
from app.api.websockets import sio
from app.db.base import Base
from app.db.session import engine
from app.db.sqlite_compat import ensure_user_table_columns
from app.models.user import User  # Importar para que Base conozca la tabla
from app.models.system_settings import SystemSettings  # tabla system_settings

_log = logging.getLogger("uvicorn.error")

# Crear tablas en SQLite si no existen + alinear columnas si el modelo creció
Base.metadata.create_all(bind=engine)
ensure_user_table_columns(engine)


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

# Rutas REST antes del wrapper Socket.IO (mismo objeto `app`).
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(settings_public.router, prefix="/api/settings", tags=["settings"])
app.include_router(translate.router, prefix="/api", tags=["translate"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "Albedrío API is running"}


@app.get("/health")
async def health_short():
    """Alias corto: si /api/health da 404, prueba esta URL en el mismo puerto."""
    return {"status": "ok", "service": "ometv-api", "route": "/health"}


@app.get("/api/health")
async def api_health():
    """Sin auth: sirve para comprobar que este proceso es el API correcto (evitar otro servicio en el mismo puerto)."""
    return {"status": "ok", "service": "ometv-api", "route": "/api/health"}


# ASGI: Socket.IO + FastAPI. CORS debe envolver el árbol COMPLETO; si solo está en FastAPI, algunas
# respuestas (p. ej. errores en el puente ASGI) no llevan Access-Control-Allow-Origin.
_mount = socketio.ASGIApp(sio, app)

_extra_origins = [
    o.strip()
    for o in os.getenv("CORS_EXTRA_ORIGINS", "").split(",")
    if o.strip()
]
_allow_origins = [
    "https://omeclone-web.onrender.com",
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
