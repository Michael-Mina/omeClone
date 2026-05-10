"""Verificación de tokens OAuth (Google ID token, Facebook access token) sin Firebase."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

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


def _http_json(url: str, timeout: float = 15.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "omeClone-oauth/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode()
            err = json.loads(body)
            msg = err.get("error", {}).get("message") if isinstance(err, dict) else body
        except Exception:
            msg = str(e)
        raise ValueError(msg or "Error HTTP al validar con Facebook") from e


def verify_facebook_access_token(user_token: str) -> dict:
    """
    Comprueba que el token sea de nuestra app y obtiene id, name, email desde Graph API.
    """
    app_id = (settings.FACEBOOK_APP_ID or "").strip()
    secret = (settings.FACEBOOK_APP_SECRET or "").strip()
    if not app_id or not secret:
        raise ValueError("Facebook OAuth no está configurado en el servidor")

    app_access = f"{app_id}|{secret}"
    q = urllib.parse.urlencode(
        {"input_token": user_token, "access_token": app_access},
        quote_via=urllib.parse.quote,
    )
    debug_url = f"https://graph.facebook.com/debug_token?{q}"
    dbg = _http_json(debug_url)
    data = (dbg.get("data") or {}) if isinstance(dbg, dict) else {}
    if not data.get("is_valid"):
        raise ValueError("Token de Facebook inválido o expirado")
    if str(data.get("app_id")) != app_id:
        raise ValueError("Token de Facebook no pertenece a esta aplicación")

    me_q = urllib.parse.urlencode({"fields": "id,name,email", "access_token": user_token})
    me_url = f"https://graph.facebook.com/me?{me_q}"
    profile = _http_json(me_url)
    if not isinstance(profile, dict) or not profile.get("id"):
        raise ValueError("No se pudo leer el perfil de Facebook")
    return profile

