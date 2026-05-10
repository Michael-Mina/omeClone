from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True) # Nullable for anonymous
    hashed_password = Column(String, nullable=True)
    # OAuth (sub/id estable del proveedor; login sin contraseña local)
    oauth_google_sub = Column(String(255), unique=True, index=True, nullable=True)
    oauth_facebook_id = Column(String(255), unique=True, index=True, nullable=True)
    is_active = Column(Boolean, default=True)
    is_anonymous = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Profile fields
    display_name = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    birth_year = Column(Integer, nullable=True)
    country = Column(String, nullable=True)
    language = Column(String, nullable=True)
    reputation_score = Column(Integer, default=100)
    is_banned = Column(Boolean, default=False)
    is_superuser = Column(Boolean, default=False)
    # Admin: no aplicar ban / no cargar modelo NSFW en cliente (token lleva la IA).
    exempt_from_ban = Column(Boolean, default=False)
    exempt_from_ai_censorship = Column(Boolean, default=False)

    # Política NSFW (cliente reporta strike tras detección sostenida; servidor es fuente de verdad).
    nsfw_strike_count = Column(Integer, default=0, nullable=False)
    nsfw_ban_until = Column(DateTime(timezone=True), nullable=True)
    nsfw_permanent_ban = Column(Boolean, default=False, nullable=False)
