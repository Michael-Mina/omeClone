from pydantic_settings import BaseSettings
from typing import Optional, List


def normalize_database_url(url: str) -> str:
    """Convierte postgres:// / postgresql:// al dialecto SQLAlchemy con psycopg2."""
    u = url.strip()
    if not u or u.startswith("sqlite"):
        return u
    if "+psycopg2://" in u or "+pg8000://" in u or "+asyncpg://" in u:
        return u
    if u.startswith("postgres://"):
        return "postgresql+psycopg2://" + u[len("postgres://") :]
    if u.startswith("postgresql://"):
        return "postgresql+psycopg2://" + u[len("postgresql://") :]
    return u


class Settings(BaseSettings):
    PROJECT_NAME: str = "OmeTV Clone API"
    
    SECRET_KEY: str = "dev_secret_key_change_in_production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    POSTGRES_SERVER: str = "127.0.0.1"
    POSTGRES_USER: str = "ometv_user"
    POSTGRES_PASSWORD: str = "ometv_password"
    POSTGRES_DB: str = "ometv_db"
    POSTGRES_PORT: str = "5440"

    DATABASE_URL: Optional[str] = None

    # OAuth Google (IDs públicos; el front los obtiene de GET /api/auth/oauth/providers)
    GOOGLE_OAUTH_CLIENT_IDS: Optional[str] = None

    @property
    def google_oauth_client_id_list(self) -> List[str]:
        raw = (self.GOOGLE_OAUTH_CLIENT_IDS or "").strip()
        if not raw:
            return []
        return [x.strip() for x in raw.split(",") if x.strip()]

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        if self.DATABASE_URL:
            return normalize_database_url(self.DATABASE_URL)
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    model_config = {
        "env_file": ".env",
        "extra": "ignore"
    }

settings = Settings()
