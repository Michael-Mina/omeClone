"""Verificación del JWT de Google Identity Services (sin Firebase)."""
from __future__ import annotations

from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.core.config import settings


def verify_google_credential(jwt_str: str) -> dict:
    """
    Valida el JWT de Google Identity Services y devuelve claims (sub, email, name, picture...).
    """
    ids = settings.google_oauth_client_id_list
    if not ids:
        raise ValueError("Google OAuth no está configurado en el servidor")
    req = google_requests.Request()
    idinfo = google_id_token.verify_oauth2_token(jwt_str, req, audience=ids)
    if idinfo.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        raise ValueError("Token Google inválido (issuer)")
    return idinfo
