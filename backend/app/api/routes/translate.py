"""Traducción de chat hacia el idioma de cuenta (deep-translator / Google vía librería)."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()

_ALLOWED_TARGETS = frozenset({"es", "en", "pt", "fr", "de", "it"})


def _normalize_target(code: str | None) -> str:
    if not code or not str(code).strip():
        return "en"
    c = str(code).strip().lower()
    if c == "other":
        return "en"
    return c if c in _ALLOWED_TARGETS else "en"


class TranslateBody(BaseModel):
    text: str = Field(..., max_length=2000)
    target_lang: str = Field(..., description="Código perfil: es, en, pt, … o OTHER→en")


class TranslateResponse(BaseModel):
    text: str


def _translate_sync(text: str, target: str) -> str:
    if not text.strip():
        return text
    try:
        from deep_translator import GoogleTranslator

        return GoogleTranslator(source="auto", target=target).translate(text) or text
    except Exception:
        return text


@router.post("/translate", response_model=TranslateResponse)
async def translate_chat_line(body: TranslateBody, _user: User = Depends(get_current_user)):
    raw = body.text.strip()
    if not raw:
        return TranslateResponse(text="")
    tgt = _normalize_target(body.target_lang)
    # Evitar trabajo innecesario si solo hay emojis / símbolos sin letras (heurística ligera).
    if not any(ch.isalpha() for ch in raw):
        return TranslateResponse(text=raw)
    out = await asyncio.to_thread(_translate_sync, raw, tgt)
    return TranslateResponse(text=out if isinstance(out, str) else raw)
