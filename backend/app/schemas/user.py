from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: Optional[EmailStr] = None
    display_name: Optional[str] = None
    gender: Optional[str] = None
    birth_year: Optional[int] = None
    country: Optional[str] = None
    language: Optional[str] = None

class UserCreate(UserBase):
    password: Optional[str] = None
    is_anonymous: bool = False


class AnonymousLoginIn(BaseModel):
    """Acceso rápido: perfil demográfico + mayoría de edad verificada en servidor."""

    birth_year: int
    gender: str
    country: str
    language: str
    adult_declaration: bool

class UserResponse(UserBase):
    id: int
    is_anonymous: bool
    reputation_score: int
    is_banned: bool
    is_superuser: bool = False
    exempt_from_ban: bool = False
    exempt_from_ai_censorship: bool = False
    created_at: datetime
    nsfw_strike_count: int = 0
    nsfw_ban_until: Optional[datetime] = None
    nsfw_permanent_ban: bool = False

    class Config:
        from_attributes = True


class NsfwStrikeResponse(BaseModel):
    nsfw_strike_count: int
    nsfw_ban_until: Optional[datetime] = None
    nsfw_permanent_ban: bool
    is_banned: bool

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    is_superuser: bool = False
    user_id: Optional[int] = None
    display_name: Optional[str] = None
    exempt_from_ai_censorship: bool = False
    nsfw_strike_count: int = 0
    nsfw_ban_until: Optional[datetime] = None
    nsfw_permanent_ban: bool = False


class UserExemptionsUpdate(BaseModel):
    exempt_from_ban: Optional[bool] = None
    exempt_from_ai_censorship: Optional[bool] = None


class UserProfileUpdate(BaseModel):
    """Actualización parcial de perfil (usuarios con cuenta, no anónimos)."""

    display_name: Optional[str] = None
    gender: Optional[str] = None
    country: Optional[str] = None
    language: Optional[str] = None
    birth_year: Optional[int] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class OAuthSignupExtras(BaseModel):
    """Campos obligatorios para alta nueva vía Google (mayores de edad + perfil mínimo)."""

    birth_year: Optional[int] = None
    gender: Optional[str] = None
    country: Optional[str] = None
    language: Optional[str] = None
    adult_declaration: bool = False


class OAuthGoogleIn(OAuthSignupExtras):
    credential: str
