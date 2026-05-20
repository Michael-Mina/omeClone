from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.suggestion import Suggestion
from app.models.user import User
from app.schemas.suggestion import SuggestionCreate, SuggestionOut

router = APIRouter()


@router.post("", response_model=SuggestionOut, status_code=status.HTTP_201_CREATED)
def create_suggestion(
    body: SuggestionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = body.message.strip()
    if len(text) < 10:
        raise HTTPException(status_code=400, detail="Escribe al menos 10 caracteres")

    row = Suggestion(user_id=current_user.id, message=text)
    db.add(row)
    db.commit()
    db.refresh(row)

    return SuggestionOut(
        id=row.id,
        user_id=current_user.id,
        display_name=current_user.display_name,
        email=current_user.email,
        is_anonymous=bool(current_user.is_anonymous),
        message=row.message,
        created_at=row.created_at,
        read_at=row.read_at,
    )
