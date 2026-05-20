from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.user import User
from app.core.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _user_from_token(db: Session, token: str) -> User | None:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    return user


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)):
    user = _user_from_token(db, token)
    if user.is_banned and not getattr(user, "exempt_from_ban", False) and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tu cuenta está suspendida.",
        )
    return user


def get_current_user_allow_banned(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)):
    """
    Igual que get_current_user pero sin bloquear cuentas suspendidas.
    Necesario para GET /me: el cliente debe leer is_banned y nsfw_* tras F5.
    El resto de rutas siguen usando get_current_user.
    """
    return _user_from_token(db, token)

def get_current_superuser(current_user: User = Depends(get_current_user)):
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions"
        )
    return current_user
