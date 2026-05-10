from pydantic_settings import BaseSettings
from typing import Optional

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
    
    REDIS_URL: str = "redis://localhost:6379/0"

    DATABASE_URL: Optional[str] = None

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"postgresql+pg8000://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    model_config = {
        "env_file": ".env",
        "extra": "ignore"
    }

settings = Settings()
