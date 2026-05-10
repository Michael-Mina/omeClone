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
    NsfwStrikeResponse,
)
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.age import is_at_least_age, MIN_REGISTER_AGE
from app.api.deps import get_current_user
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
    }


def _raise_if_login_blocked(user: User) -> None:
    if user.is_banned and not getattr(user, "exempt_from_ban", False) and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta está suspendida.",
        )

router = APIRouter()

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Registra un strike tras detección NSFW sostenida en el cliente (fuente de verdad servidor)."""
    user = current_user
    now = datetime.now(timezone.utc)

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
