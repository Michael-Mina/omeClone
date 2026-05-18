from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi.security import OAuth2PasswordRequestForm
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import (
    UserCreate,
    UserResponse,
    Token,
    AnonymousLoginIn,
    UserProfileUpdate,
    NsfwStrikeIn,
    NsfwStrikeResponse,
    OAuthGoogleIn,
    OAuthSignupExtras,
)
from app.services.oauth_verify import verify_google_credential
from app.core.config import settings
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.age import is_at_least_age, MIN_REGISTER_AGE
from app.api.deps import get_current_user
from app.services.premium import premium_status_dict
from jose import jwt, JWTError
from fastapi import Header
import uuid

NSFW_COOLDOWN_MINUTES = 2
NSFW_STRIKES_PERMANENT = 10


def _token_payload(user: User) -> dict:
    return {
        "access_token": create_access_token(subject=user.id),
        "token_type": "bearer",
        "is_superuser": user.is_superuser,
        "user_id": user.id,
        "display_name": user.display_name,
        "exempt_from_ai_censorship": bool(getattr(user, "exempt_from_ai_censorship", False)),
        "nsfw_strike_count": int(getattr(user, "nsfw_strike_count", 0) or 0),
        "nsfw_ban_until": user.nsfw_ban_until,
        "nsfw_permanent_ban": bool(getattr(user, "nsfw_permanent_ban", False)),
        **premium_status_dict(user),
    }


def _raise_if_login_blocked(user: User) -> None:
    if user.is_banned and not getattr(user, "exempt_from_ban", False) and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta está suspendida.",
        )


def _oauth_profile_incomplete(body: OAuthSignupExtras) -> bool:
    return (
        body.birth_year is None
        or not (body.gender or "").strip()
        or not (body.country or "").strip()
        or not (body.language or "").strip()
        or not body.adult_declaration
    )


def _validate_oauth_profile(body: OAuthSignupExtras) -> None:
    if not body.adult_declaration:
        raise HTTPException(status_code=400, detail="Debes confirmar mayoría de edad")
    if body.birth_year is None or not is_at_least_age(body.birth_year):
        raise HTTPException(
            status_code=400,
            detail=f"Debes tener al menos {MIN_REGISTER_AGE} años",
        )
    if not body.gender or not body.country or not body.language:
        raise HTTPException(status_code=400, detail="Indica género, país e idioma")


def _oauth_profile_required_exc() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "oauth_profile_required",
            "message": "Completa género, país, idioma y año de nacimiento para crear tu cuenta.",
        },
    )


def _create_oauth_user(
    db: Session,
    *,
    email: str | None,
    display_name: str,
    oauth_google_sub: str | None,
    oauth_facebook_id: str | None,
    birth_year: int,
    gender: str,
    country: str,
    language: str,
) -> User:
    if email:
        clash = db.query(User).filter(User.email == email).first()
        if clash:
            raise HTTPException(
                status_code=409,
                detail="Ya existe una cuenta con este correo. Inicia sesión con Google usando ese correo.",
            )
    new_user = User(
        email=email,
        hashed_password=None,
        oauth_google_sub=oauth_google_sub,
        oauth_facebook_id=oauth_facebook_id,
        display_name=display_name or f"User_{uuid.uuid4().hex[:6]}",
        is_anonymous=False,
        gender=gender,
        birth_year=birth_year,
        country=country,
        language=language,
    )
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="No se pudo crear la cuenta (dato duplicado).") from None
    db.refresh(new_user)
    return new_user


router = APIRouter()


@router.get("/oauth/providers")
def oauth_providers():
    """Expone el ID de cliente Google para el SDK en el front (Render / mismo backend)."""
    g_ids = settings.google_oauth_client_id_list
    return {
        "google": {"enabled": bool(g_ids), "client_id": g_ids[0] if g_ids else None},
    }


@router.post("/oauth/google", response_model=Token)
def oauth_google(body: OAuthGoogleIn, db: Session = Depends(get_db)):
    if not settings.google_oauth_client_id_list:
        raise HTTPException(status_code=503, detail="Inicio de sesión con Google no está configurado")
    try:
        claims = verify_google_credential(body.credential)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=400, detail="Token Google incompleto")

    email = claims.get("email")
    if isinstance(email, str):
        email = email.strip() or None
    else:
        email = None

    name = (claims.get("name") or claims.get("given_name") or "").strip()

    existing = db.query(User).filter(User.oauth_google_sub == str(sub)).first()
    if existing:
        _raise_if_login_blocked(existing)
        return _token_payload(existing)

    if _oauth_profile_incomplete(body):
        raise _oauth_profile_required_exc()

    _validate_oauth_profile(body)
    assert body.birth_year is not None
    user = _create_oauth_user(
        db,
        email=email,
        display_name=name or f"User_{uuid.uuid4().hex[:6]}",
        oauth_google_sub=str(sub),
        oauth_facebook_id=None,
        birth_year=body.birth_year,
        gender=body.gender or "",
        country=body.country or "",
        language=body.language or "",
    )
    return _token_payload(user)


@router.post("/register", response_model=UserResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    if not user_in.is_anonymous:
        if not user_in.password or not user_in.email:
            raise HTTPException(status_code=400, detail="Email y contraseña son obligatorios")
        if not user_in.gender or not user_in.country or not user_in.language:
            raise HTTPException(
                status_code=400,
                detail="Debes indicar género, país e idioma",
            )
        if user_in.birth_year is None or not is_at_least_age(user_in.birth_year):
            raise HTTPException(
                status_code=400,
                detail=f"Debes tener al menos {MIN_REGISTER_AGE} años",
            )

    # Simple check for existing email
    if user_in.email:
        existing_user = db.query(User).filter(User.email == user_in.email).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
            
    hashed_password = get_password_hash(user_in.password) if user_in.password else None
    
    new_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        display_name=user_in.display_name or f"User_{uuid.uuid4().hex[:6]}",
        is_anonymous=user_in.is_anonymous,
        gender=user_in.gender,
        birth_year=user_in.birth_year,
        country=user_in.country,
        language=user_in.language
    )
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered") from None
    db.refresh(new_user)
    return new_user

@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _raise_if_login_blocked(user)
    return _token_payload(user)

@router.post("/anonymous-login", response_model=Token)
def anonymous_login(payload: AnonymousLoginIn, db: Session = Depends(get_db)):
    if not payload.adult_declaration:
        raise HTTPException(
            status_code=400,
            detail="Debes confirmar que tienes la mayoría de edad",
        )
    if not is_at_least_age(payload.birth_year):
        raise HTTPException(
            status_code=400,
            detail=f"Solo pueden acceder mayores de {MIN_REGISTER_AGE} años",
        )
    if not payload.gender or not payload.country or not payload.language:
        raise HTTPException(
            status_code=400,
            detail="Selecciona género, país e idioma",
        )

    new_user = User(
        is_anonymous=True,
        display_name=f"Anon_{uuid.uuid4().hex[:6]}",
        gender=payload.gender,
        birth_year=payload.birth_year,
        country=payload.country,
        language=payload.language,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return _token_payload(new_user)


@router.post("/nsfw-strike", response_model=NsfwStrikeResponse)
def record_nsfw_strike(
    body: NsfwStrikeIn | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Registra un strike tras detección NSFW sostenida en el cliente (fuente de verdad servidor)."""
    user = current_user
    now = datetime.now(timezone.utc)
    zone = (body.match_zone if body else None) or "moderated"
    if str(zone).strip().lower() == "adult":
        return NsfwStrikeResponse(
            nsfw_strike_count=int(getattr(user, "nsfw_strike_count", 0) or 0),
            nsfw_ban_until=user.nsfw_ban_until,
            nsfw_permanent_ban=bool(getattr(user, "nsfw_permanent_ban", False)),
            is_banned=bool(user.is_banned),
        )

    if getattr(user, "exempt_from_ai_censorship", False) or user.is_superuser:
        return NsfwStrikeResponse(
            nsfw_strike_count=int(getattr(user, "nsfw_strike_count", 0) or 0),
            nsfw_ban_until=user.nsfw_ban_until,
            nsfw_permanent_ban=bool(getattr(user, "nsfw_permanent_ban", False)),
            is_banned=bool(user.is_banned),
        )

    if getattr(user, "nsfw_permanent_ban", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta suspendida por infracciones reiteradas.",
        )

    bu = user.nsfw_ban_until
    if bu is not None and bu > now:
        return NsfwStrikeResponse(
            nsfw_strike_count=int(getattr(user, "nsfw_strike_count", 0) or 0),
            nsfw_ban_until=bu,
            nsfw_permanent_ban=bool(getattr(user, "nsfw_permanent_ban", False)),
            is_banned=bool(user.is_banned),
        )

    user.nsfw_strike_count = int(getattr(user, "nsfw_strike_count", 0) or 0) + 1
    user.nsfw_ban_until = now + timedelta(minutes=NSFW_COOLDOWN_MINUTES)
    if user.nsfw_strike_count >= NSFW_STRIKES_PERMANENT:
        user.nsfw_permanent_ban = True
        user.is_banned = True

    db.add(user)
    db.commit()
    db.refresh(user)

    return NsfwStrikeResponse(
        nsfw_strike_count=int(user.nsfw_strike_count or 0),
        nsfw_ban_until=user.nsfw_ban_until,
        nsfw_permanent_ban=bool(user.nsfw_permanent_ban),
        is_banned=bool(user.is_banned),
    )


@router.post("/refresh", response_model=Token)
def refresh_access_token(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Nuevo access_token si el JWT sigue siendo del usuario (aunque haya expirado)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    raw = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(
            raw,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False},
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    _raise_if_login_blocked(user)
    return _token_payload(user)


@router.get("/me", response_model=UserResponse)
def read_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserResponse)
def update_me(
    body: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_anonymous:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Las sesiones anónimas no pueden editar el perfil. Crea una cuenta con correo.",
        )

    if body.display_name is not None:
        current_user.display_name = body.display_name.strip() or current_user.display_name
    if body.gender is not None:
        current_user.gender = body.gender
    if body.country is not None:
        current_user.country = body.country
    if body.language is not None:
        current_user.language = body.language
    if body.birth_year is not None:
        if not is_at_least_age(body.birth_year):
            raise HTTPException(
                status_code=400,
                detail=f"La edad debe cumplir al menos {MIN_REGISTER_AGE} años",
            )
        current_user.birth_year = body.birth_year

    if body.new_password:
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 6 caracteres")
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Indica tu contraseña actual para cambiarla")
        if not current_user.hashed_password:
            raise HTTPException(status_code=400, detail="Esta cuenta no tiene contraseña configurada")
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="La contraseña actual no es correcta")
        current_user.hashed_password = get_password_hash(body.new_password)

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user
