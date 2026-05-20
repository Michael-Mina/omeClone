from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.user import User
from app.api.websockets import online_users, sio
from app.api.deps import get_current_superuser
from app.schemas.user import UserExemptionsUpdate
from app.models.system_settings import SystemSettings
from app.schemas.global_settings import NsfwGlobalPatch, NsfwGlobalAdminOut
from app.schemas.billing import AdminPremiumPatch, BillingSettingsOut, BillingSettingsPatch
from app.models.suggestion import Suggestion
from app.schemas.suggestion import SuggestionListOut, SuggestionOut
from app.services.nsfw_client_params import clamp_intensity, intensity_to_client_params
from app.services.premium import apply_premium_active, clear_premium, user_has_premium, premium_status_dict
from app.core.config import settings as app_settings

router = APIRouter()


def _later_iso_ban_until(a: object | None, b: object | None) -> str | None:
    """Elige la fecha de fin de bloqueo IA más tardía (misma cuenta, varios sockets)."""
    if a is None:
        return str(b) if b is not None else None
    if b is None:
        return str(a)
    try:
        sa = str(a).strip().replace("Z", "+00:00")
        sb = str(b).strip().replace("Z", "+00:00")
        if " " in sa and "T" not in sa:
            sa = sa.replace(" ", "T", 1)
        if " " in sb and "T" not in sb:
            sb = sb.replace(" ", "T", 1)
        da = datetime.fromisoformat(sa)
        db = datetime.fromisoformat(sb)
        return a if da >= db else b  # type: ignore[return-value]
    except Exception:
        return a if a else b  # type: ignore[return-value]


def _sanction_fields_from_user(u: User | None) -> dict:
    """Campos de sanción para el listado admin (y sockets con fila en BD)."""
    if u is None:
        return {
            "is_banned": False,
            "nsfw_permanent_ban": False,
            "nsfw_ban_until": None,
        }
    bu = getattr(u, "nsfw_ban_until", None)
    bu_out: str | None = None
    if bu is not None:
        if getattr(bu, "tzinfo", None) is None:
            bu = bu.replace(tzinfo=timezone.utc)
        bu_out = bu.isoformat()
    return {
        "is_banned": bool(getattr(u, "is_banned", False)),
        "nsfw_permanent_ban": bool(getattr(u, "nsfw_permanent_ban", False)),
        "nsfw_ban_until": bu_out,
    }


def _presence_sort_key(row: dict):
    order = {"in_call": 0, "waiting": 1, "offline": 2}
    return (order.get(row.get("presence"), 9), (row.get("display_name") or "").lower())


def _ws_user_id_matches_db(uid_raw: object, db_id: int) -> bool:
    """Compara user_id guardado en online_users con el PK de usuarios."""
    if uid_raw is None:
        return False
    s = str(uid_raw).strip()
    if not s:
        return False
    if s == str(db_id):
        return True
    try:
        return int(s) == int(db_id)
    except (TypeError, ValueError):
        return False


def _pick_better_online_row(a: dict, b: dict) -> dict:
    """
    Un mismo usuario registrado puede tener varios sockets (pestañas / reconexión).
    Priorizar «en llamada» sobre «esperando» para una sola fila coherente en el admin.
    """
    rank = {"in_call": 2, "waiting": 1}
    ra = rank.get(a.get("presence"), 0)
    rb = rank.get(b.get("presence"), 0)
    if rb > ra:
        winner, other = b, a
    elif ra > rb:
        winner, other = a, b
    else:
        sa, sb = str(a.get("sid") or ""), str(b.get("sid") or "")
        winner, other = (a, b) if sa <= sb else (b, a)
    merged = dict(winner)
    merged["exempt_from_ban"] = bool(winner.get("exempt_from_ban") or other.get("exempt_from_ban"))
    merged["exempt_from_ai_censorship"] = bool(
        winner.get("exempt_from_ai_censorship") or other.get("exempt_from_ai_censorship")
    )
    merged["is_banned"] = bool(winner.get("is_banned") or other.get("is_banned"))
    merged["nsfw_permanent_ban"] = bool(winner.get("nsfw_permanent_ban") or other.get("nsfw_permanent_ban"))
    merged["nsfw_ban_until"] = _later_iso_ban_until(winner.get("nsfw_ban_until"), other.get("nsfw_ban_until"))
    return merged


@router.get("/dashboard-users")
def get_dashboard_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_superuser)):
    """
    Lista unificada: sockets activos + cuentas registradas sin conexión (offline).
    Los anónimos solo aparecen mientras están conectados; al desconectar se borran en BD.
    Usuarios registrados con varios sockets se fusionan en una fila (prioridad: en llamada > esperando).
    """
    from app.api.websockets import user_rooms, online_users

    online_rows: list[dict] = []

    for sid, info in list(online_users.items()):
        if info.get("role") == "superadmin":
            continue

        uid_raw = info.get("user_id")
        candidate_db_uid = None
        try:
            if uid_raw is not None and str(uid_raw).strip() != "":
                candidate_db_uid = int(uid_raw)
        except (TypeError, ValueError):
            candidate_db_uid = None

        room = user_rooms.get(sid)
        connected_to = None
        if room:
            for p_sid, p_room in user_rooms.items():
                if p_room == room and p_sid != sid:
                    peer_info = online_users.get(p_sid, {})
                    connected_to = {
                        "sid": p_sid,
                        "user_id": peer_info.get("user_id"),
                        "display_name": peer_info.get("display_name", "Anónimo"),
                    }
                    break

        by = info.get("birth_year")
        try:
            by_int = int(by) if by is not None else None
        except (TypeError, ValueError):
            by_int = None

        presence = "in_call" if room else "waiting"

        gender_c = info.get("gender")
        country_c = info.get("country")
        language_c = info.get("language")
        is_anon = bool(info.get("is_anonymous"))
        exempt_from_ban = False
        exempt_from_ai_censorship = False
        is_premium = False
        premium_source = None
        udb = db.get(User, candidate_db_uid) if candidate_db_uid is not None else None
        if udb:
            gender_c = gender_c or udb.gender
            country_c = country_c or udb.country
            language_c = language_c or udb.language
            by_int = by_int if by_int is not None else udb.birth_year
            if getattr(udb, "is_anonymous", False):
                is_anon = True
            exempt_from_ban = bool(getattr(udb, "exempt_from_ban", False))
            exempt_from_ai_censorship = bool(getattr(udb, "exempt_from_ai_censorship", False))
            is_premium = user_has_premium(udb)
            premium_source = getattr(udb, "premium_source", None)

        db_uid = candidate_db_uid if udb is not None else None

        snap = _sanction_fields_from_user(udb)
        online_rows.append({
            "row_key": sid,
            "sid": sid,
            "db_user_id": db_uid,
            "user_id": str(uid_raw) if uid_raw is not None else None,
            "display_name": info.get("display_name") or "Anónimo",
            "role": info.get("role", "user"),
            "presence": presence,
            "is_anonymous": is_anon,
            "gender": gender_c,
            "birth_year": by_int,
            "country": country_c,
            "language": language_c,
            "connected_to": connected_to,
            "exempt_from_ban": exempt_from_ban,
            "exempt_from_ai_censorship": exempt_from_ai_censorship,
            "is_premium": is_premium,
            "premium_source": premium_source,
            "match_room_id": room,
            "match_zone": info.get("match_zone") or "moderated",
            **snap,
        })

    merged_by_db_id: dict[int, dict] = {}
    anon_online_rows: list[dict] = []
    for row in online_rows:
        db_id = row.get("db_user_id")
        if db_id is not None:
            existing = merged_by_db_id.get(db_id)
            merged_by_db_id[db_id] = row if existing is None else _pick_better_online_row(existing, row)
        else:
            anon_online_rows.append(row)

    online_db_ids_seen = set(merged_by_db_id.keys())
    users_list = list(merged_by_db_id.values()) + anon_online_rows

    registered = (
        db.query(User)
        .filter(User.is_anonymous == False, User.is_superuser == False)
        .order_by(User.id.desc())
        .all()
    )

    for u in registered:
        if u.id in online_db_ids_seen:
            continue
        snap = _sanction_fields_from_user(u)
        users_list.append({
                "row_key": f"offline-{u.id}",
                "sid": None,
                "db_user_id": u.id,
                "user_id": str(u.id),
                "display_name": u.display_name or f"Usuario_{u.id}",
                "role": "user",
                "presence": "offline",
                "is_anonymous": False,
                "gender": u.gender,
                "birth_year": u.birth_year,
                "country": u.country,
                "language": u.language,
                "connected_to": None,
                "exempt_from_ban": bool(getattr(u, "exempt_from_ban", False)),
                "exempt_from_ai_censorship": bool(getattr(u, "exempt_from_ai_censorship", False)),
                "is_premium": user_has_premium(u),
                "premium_source": getattr(u, "premium_source", None),
                "match_room_id": None,
                "match_zone": None,
                **snap,
            })

    users_list.sort(key=_presence_sort_key)
    return {"users": users_list}


@router.get("/online-users")
def get_online_users_alias(current_user: User = Depends(get_current_superuser), db: Session = Depends(get_db)):
    """Compatibilidad con clientes antiguos: mismo payload que antes solo para filas «en línea»."""
    data = get_dashboard_users(db=db, current_user=current_user)
    slim = []
    for u in data["users"]:
        if u["presence"] == "offline":
            continue
        slim.append({
            "sid": u["sid"],
            "user_id": u["user_id"],
            "display_name": u["display_name"],
            "role": u["role"],
            "status": "in_call" if u["presence"] == "in_call" else "idle",
            "connected_to": u["connected_to"],
        })
    return {"users": slim}

@router.patch("/users/{user_id}/exemptions")
@router.put("/users/{user_id}/exemptions")
async def update_user_exemptions(
    user_id: int,
    body: UserExemptionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_superuser),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if body.exempt_from_ban is not None:
        user.exempt_from_ban = body.exempt_from_ban
    if body.exempt_from_ai_censorship is not None:
        user.exempt_from_ai_censorship = body.exempt_from_ai_censorship
    db.commit()
    db.refresh(user)
    payload = {
        "user_id": user.id,
        "exempt_from_ban": bool(getattr(user, "exempt_from_ban", False)),
        "exempt_from_ai_censorship": bool(getattr(user, "exempt_from_ai_censorship", False)),
    }
    for sid, info in list(online_users.items()):
        if _ws_user_id_matches_db(info.get("user_id"), user.id):
            await sio.emit("exemptions_updated", payload, to=str(sid))
    return payload


@router.put("/users/{user_id}/ban")
async def ban_user(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_superuser)):
    # 1. Update in DB if it's a real user ID (integer)
    try:
        real_id = int(user_id)
        user = db.query(User).filter(User.id == real_id).first()
        if user:
            if bool(getattr(user, "exempt_from_ban", False)):
                raise HTTPException(
                    status_code=400,
                    detail="Este usuario está exento de baneos",
                )
            user.is_banned = True
            db.commit()
    except ValueError:
        pass # It's probably an anon string, we just kick them from current session
        
    # 2. Kick them from websockets and mark as banned in memory
    for sid, info in list(online_users.items()):
        if str(info.get("user_id")) == str(user_id):
            # Emit a ban event so client disconnects and shows message
            await sio.emit('banned', to=sid)
            # Desconectar al usuario
            await sio.disconnect(sid)

    return {"message": f"User {user_id} has been banned."}

@router.put("/users/{user_id}/unban")
def unban_user(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_superuser)):
    try:
        real_id = int(user_id)
        user = db.query(User).filter(User.id == real_id).first()
        if user:
            user.is_banned = False
            db.commit()
            return {"message": f"User {user_id} has been unbanned."}
        else:
            raise HTTPException(status_code=404, detail="User not found")
    except ValueError:
        return {"message": "Anonymous users cannot be permanently unbanned."}


def _get_or_create_system_settings(db: Session) -> SystemSettings:
    row = db.get(SystemSettings, 1)
    if row is None:
        row = SystemSettings(id=1, nsfw_global_intensity=50)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/nsfw-global", response_model=NsfwGlobalAdminOut)
def admin_get_nsfw_global(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    row = _get_or_create_system_settings(db)
    dto = intensity_to_client_params(row.nsfw_global_intensity)
    return NsfwGlobalAdminOut(**dto.as_dict())


@router.put("/nsfw-global", response_model=NsfwGlobalAdminOut)
async def admin_put_nsfw_global(
    body: NsfwGlobalPatch,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    row = _get_or_create_system_settings(db)
    row.nsfw_global_intensity = clamp_intensity(body.intensity)
    db.commit()
    db.refresh(row)
    dto = intensity_to_client_params(row.nsfw_global_intensity)
    payload = dto.as_dict()
    await sio.emit("nsfw_global_settings_updated", payload)
    return NsfwGlobalAdminOut(**payload)


@router.get("/billing-settings", response_model=BillingSettingsOut)
def admin_get_billing_settings(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    row = _get_or_create_system_settings(db)
    configured = bool(app_settings.STRIPE_SECRET_KEY and app_settings.STRIPE_PRICE_ID)
    return BillingSettingsOut(
        payments_enabled=bool(getattr(row, "payments_enabled", False)),
        stripe_configured=configured,
    )


@router.put("/billing-settings", response_model=BillingSettingsOut)
def admin_put_billing_settings(
    body: BillingSettingsPatch,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    row = _get_or_create_system_settings(db)
    row.payments_enabled = body.payments_enabled
    db.commit()
    db.refresh(row)
    configured = bool(app_settings.STRIPE_SECRET_KEY and app_settings.STRIPE_PRICE_ID)
    return BillingSettingsOut(
        payments_enabled=bool(row.payments_enabled),
        stripe_configured=configured,
    )


@router.put("/users/{user_id}/premium")
async def admin_set_user_premium(
    user_id: int,
    body: AdminPremiumPatch,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.is_superuser:
        raise HTTPException(status_code=400, detail="No aplica a superadmin")
    if user.is_anonymous:
        raise HTTPException(status_code=400, detail="Los anónimos no tienen premium persistente")

    if body.enabled:
        apply_premium_active(user, source="admin", until=None)
    else:
        clear_premium(user)

    db.commit()
    db.refresh(user)
    payload = {"user_id": user.id, **premium_status_dict(user)}
    for sid, info in list(online_users.items()):
        if _ws_user_id_matches_db(info.get("user_id"), user.id):
            await sio.emit("premium_updated", payload, to=str(sid))
    return payload


def _suggestion_to_out(row: Suggestion, user: User | None) -> SuggestionOut:
    return SuggestionOut(
        id=row.id,
        user_id=row.user_id,
        display_name=user.display_name if user else None,
        email=user.email if user else None,
        is_anonymous=bool(user.is_anonymous) if user else False,
        message=row.message,
        created_at=row.created_at,
        read_at=row.read_at,
    )


@router.get("/suggestions", response_model=SuggestionListOut)
def admin_list_suggestions(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
    limit: int = 200,
):
    cap = max(1, min(limit, 500))
    rows = (
        db.query(Suggestion)
        .order_by(Suggestion.created_at.desc())
        .limit(cap)
        .all()
    )
    user_ids = {r.user_id for r in rows if r.user_id is not None}
    users_by_id: dict[int, User] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            users_by_id[u.id] = u

    items = [_suggestion_to_out(r, users_by_id.get(r.user_id) if r.user_id else None) for r in rows]
    unread = db.query(Suggestion).filter(Suggestion.read_at.is_(None)).count()
    return SuggestionListOut(items=items, unread_count=unread)


@router.post("/suggestions/mark-all-read")
def admin_mark_suggestions_read(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    now = datetime.now(timezone.utc)
    updated = (
        db.query(Suggestion)
        .filter(Suggestion.read_at.is_(None))
        .update({Suggestion.read_at: now}, synchronize_session=False)
    )
    db.commit()
    return {"marked": updated}
