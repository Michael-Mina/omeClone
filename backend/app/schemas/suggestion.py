from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class SuggestionCreate(BaseModel):
    message: str = Field(min_length=10, max_length=2000)


class SuggestionOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    is_anonymous: bool = False
    message: str
    created_at: datetime
    read_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SuggestionListOut(BaseModel):
    items: list[SuggestionOut]
    unread_count: int
