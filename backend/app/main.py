from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio
import logging

from app.api.routes import auth, admin, translate
from app.api.websockets import sio
from app.db.base import Base
from app.db.session import engine
from app.db.sqlite_compat import ensure_user_table_columns
from app.models.user import User  # Importar para que Base conozca la tabla

_log = logging.getLogger("uvicorn.error")

# Crear tablas en SQLite si no existen + alinear columnas si el modelo creció
Base.metadata.create_all(bind=engine)
ensure_user_table_columns(engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _log.warning("[ometv] API lista — prueba: GET /health y GET /api/health en el puerto donde corre uvicorn")
    yield


app = FastAPI(title="OmeTV Clone API", lifespan=lifespan)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # TODO: Update for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rutas REST antes del wrapper Socket.IO (mismo objeto `app`).
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(translate.router, prefix="/api", tags=["translate"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "OmeTV Clone API is running"}


@app.get("/health")
async def health_short():
    """Alias corto: si /api/health da 404, prueba esta URL en el mismo puerto."""
    return {"status": "ok", "service": "ometv-api", "route": "/health"}


@app.get("/api/health")
async def api_health():
    """Sin auth: sirve para comprobar que este proceso es el API correcto (evitar otro servicio en el mismo puerto)."""
    return {"status": "ok", "service": "ometv-api", "route": "/api/health"}


# ASGI: Socket.IO + FastAPI (fallback). Uvicorn debe servir `application`, no solo `app`.
application = socketio.ASGIApp(sio, app)
socket_app = application
