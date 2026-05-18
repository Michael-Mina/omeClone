import asyncio
import time
import socketio
from app.services.matchmaking import MatchmakingService, normalize_match_zone

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# Almacena en qué sala (room) está cada usuario
user_rooms = {}
connected_users_count = 0
online_users = {}
# Admin socket id -> sids monitorizados y/o salas de match (retransmisión de chat)
admin_spy_watch_targets: dict[str, set[str]] = {}
admin_spy_watch_rooms: dict[str, set[str]] = {}

async def dissolve_active_match(leaving_sid: str, peers_auto_queue: bool) -> None:
    """
    Sale de la sala de emparejamiento actual y avisa al (los) otro(s) participante(s).
    peers_auto_queue: True cuando el usuario pulsa «Siguiente» — el otro vuelve a la cola sola/o.
    """
    if leaving_sid not in user_rooms:
        return
    room_id = user_rooms[leaving_sid]
    peer_sids = [s for s, r in user_rooms.items() if r == room_id and s != leaving_sid]

    await sio.emit(
        "peer_disconnected",
        {"auto_queue": peers_auto_queue},
        room=room_id,
        skip_sid=leaving_sid,
    )

    await sio.leave_room(leaving_sid, room_id)
    del user_rooms[leaving_sid]

    for p_sid in peer_sids:
        await sio.leave_room(p_sid, room_id)
        if p_sid in user_rooms:
            del user_rooms[p_sid]

async def broadcast_user_count():
    await sio.emit('online_users_count', {'count': connected_users_count})

@sio.event
async def connect(sid, environ, auth=None):
    global connected_users_count
    connected_users_count += 1
    print(f"[WS] Client connected: {sid}")
    await broadcast_user_count()

@sio.event
async def identify(sid, data):
    raw_uid = data.get("user_id")
    if raw_uid is None or (isinstance(raw_uid, str) and str(raw_uid).strip() == ""):
        stored_uid = sid
    else:
        stored_uid = raw_uid
    online_users[sid] = {
        "user_id": stored_uid,
        "role": data.get("role", "user"),
        "display_name": data.get("display_name") or f"Anón-{str(stored_uid)[:8]}",
        "gender": data.get("gender"),
        "country": data.get("country"),
        "language": data.get("language"),
        "birth_year": data.get("birth_year"),
        "is_anonymous": bool(data.get("is_anonymous")),
        "status": "idle",
        "match_zone": normalize_match_zone({"match_zone": data.get("match_zone")}),
    }


def _delete_anonymous_user_from_db(meta: dict) -> None:
    """Al cerrar sesión, borrar cuenta anónima de la BD; los registrados se conservan."""
    if not meta or not meta.get("is_anonymous"):
        return
    uid = meta.get("user_id")
    if uid is None:
        return
    try:
        db_id = int(uid)
    except (TypeError, ValueError):
        return
    from app.db.session import SessionLocal
    from app.models.user import User as UserModel

    db = SessionLocal()
    try:
        row = db.get(UserModel, db_id)
        if row and row.is_anonymous:
            db.delete(row)
            db.commit()
    finally:
        db.close()


@sio.event
async def disconnect(sid):
    global connected_users_count
    connected_users_count = max(0, connected_users_count - 1)
    print(f"[WS] Client disconnected: {sid}")

    await MatchmakingService.remove_from_queue(sid)

    meta = dict(online_users[sid]) if sid in online_users else None

    # Si estaba en una sala, notificar antes de borrar registros WS
    if sid in user_rooms:
        await dissolve_active_match(sid, peers_auto_queue=False)

    if sid in online_users:
        del online_users[sid]

    admin_spy_watch_targets.pop(str(sid), None)
    admin_spy_watch_rooms.pop(str(sid), None)

    await broadcast_user_count()

    if meta:
        await asyncio.to_thread(_delete_anonymous_user_from_db, meta)

@sio.event
async def start_matchmaking(sid, data):
    """
    Llamado cuando el usuario presiona "Iniciar" o "Siguiente".
    """
    user_id = data.get('user_id', 'anonymous')
    if isinstance(user_id, str) and not user_id.strip():
        user_id = "anonymous"
    filters = data.get('filters', {})
    match_zone = normalize_match_zone(filters)

    if sid in online_users:
        online_users[sid]["match_zone"] = match_zone
        online_users[sid]["status"] = "waiting"

    if match_zone == "adult":
        from app.core.age import is_at_least_age
        from app.core.legal_adult_age import legal_adult_age_for_country

        meta = online_users.get(sid) or {}
        by = meta.get("birth_year")
        country = meta.get("country")
        min_age = legal_adult_age_for_country(country)
        try:
            by_int = int(by) if by is not None else None
        except (TypeError, ValueError):
            by_int = None
        if by_int is None or not is_at_least_age(by_int, min_age):
            match_zone = "moderated"
            filters = {**(filters or {}), "match_zone": match_zone}
            if sid in online_users:
                online_users[sid]["match_zone"] = match_zone

    # Salir de la sala actual si existe (Iniciar con match previo o botón Siguiente)
    if sid in user_rooms:
        await dissolve_active_match(sid, peers_auto_queue=True)

    # Matchmaking en memoria (servicio MatchmakingService)
    match_result = await MatchmakingService.find_match_or_wait(user_id, sid, filters)
    
    if match_result.get("matched"):
        room_id = match_result["room_id"]
        peer_sid = match_result["peer_sid"]
        
        # Poner a ambos usuarios en la misma sala de Socket.IO
        await sio.enter_room(sid, room_id)
        await sio.enter_room(peer_sid, room_id)
        
        user_rooms[sid] = room_id
        user_rooms[peer_sid] = room_id

        if sid in online_users:
            online_users[sid]["match_zone"] = match_zone
            online_users[sid]["status"] = "in_call"
        if peer_sid in online_users:
            online_users[peer_sid]["match_zone"] = match_zone
            online_users[peer_sid]["status"] = "in_call"
        
        # Notificar a ambos en paralelo (menos latencia hasta match_found).
        payload = {"room_id": room_id, "match_zone": match_zone}
        await asyncio.gather(
            sio.emit('match_found', {**payload, "initiator": True}, to=sid),
            sio.emit('match_found', {**payload, "initiator": False}, to=peer_sid),
        )
    else:
        # No se encontró, esperando en cola
        await sio.emit('waiting_for_match', to=sid)

# --- WebRTC Signaling Events ---

@sio.event
async def webrtc_offer(sid, data):
    room_id = user_rooms.get(sid)
    if room_id:
        await sio.emit('webrtc_offer', data, room=room_id, skip_sid=sid)

@sio.event
async def webrtc_answer(sid, data):
    room_id = user_rooms.get(sid)
    if room_id:
        await sio.emit('webrtc_answer', data, room=room_id, skip_sid=sid)

@sio.event
async def webrtc_ice_candidate(sid, data):
    room_id = user_rooms.get(sid)
    if room_id:
        await sio.emit('webrtc_ice_candidate', data, room=room_id, skip_sid=sid)

@sio.event
async def webrtc_request_reconnect(sid, data):
    room_id = user_rooms.get(sid)
    if room_id:
        print(f"[WS] Reconnection requested by {sid} in room {room_id}")
        await sio.emit('webrtc_request_reconnect', {}, room=room_id, skip_sid=sid)

@sio.event
async def cancel_matchmaking(sid, data=None):
    """
    Called when the user presses "Cancel" to stop searching/disconnect.
    Removes from queue and leaves current room if any.
    """
    # Remove from matchmaking queue
    await MatchmakingService.remove_from_queue(sid)

    # Leave current room if connected
    if sid in user_rooms:
        await dissolve_active_match(sid, peers_auto_queue=False)

    await sio.emit('matchmaking_cancelled', to=sid)

# --- Chat Events ---

CHAT_TEXT_MAX = 2000


@sio.event
async def chat_message(sid, data):
    """Texto en la sala de match actual; todos los miembros de la sala reciben el mismo payload."""
    room_id = user_rooms.get(sid)
    if not room_id:
        return
    if not isinstance(data, dict):
        return
    text = data.get("text")
    if not isinstance(text, str):
        return
    text = text.strip()
    if not text:
        return
    if len(text) > CHAT_TEXT_MAX:
        text = text[:CHAT_TEXT_MAX]

    meta = online_users.get(sid) or {}
    sender_label = meta.get("display_name") or f"Usuario-{str(sid)[:8]}"
    sender_language = meta.get("language")

    payload = {
        "text": text,
        "sender_sid": sid,
        "sender_label": sender_label,
        "sender_language": sender_language,
        "ts": int(time.time() * 1000),
    }
    await sio.emit("chat_message", payload, room=room_id)

    room_peer_sids = {str(s) for s, r in user_rooms.items() if r == room_id}
    relay_payload = {**payload, "room_id": room_id}
    notify_admins: set[str] = set()
    for admin_sid, watched in list(admin_spy_watch_targets.items()):
        ws = {str(w) for w in watched}
        if ws & room_peer_sids:
            notify_admins.add(str(admin_sid))
    for admin_sid, rooms in list(admin_spy_watch_rooms.items()):
        rs = {str(r) for r in rooms}
        if str(room_id) in rs:
            notify_admins.add(str(admin_sid))
    for admin_sid_k in notify_admins:
        await sio.emit("admin_chat_relay", relay_payload, to=admin_sid_k)


# --- Admin Spy Events ---


@sio.event
async def admin_spy_watch(sid, data):
    """Sids y/o room_ids monitorizados; recibe copias de chat_message de esa sesión."""
    sid_k = str(sid)
    if not isinstance(data, dict):
        admin_spy_watch_targets.pop(sid_k, None)
        admin_spy_watch_rooms.pop(sid_k, None)
        return
    raw_t = data.get("targets")
    raw_r = data.get("room_ids")
    if not isinstance(raw_t, list):
        admin_spy_watch_targets.pop(sid_k, None)
    else:
        targets = {str(x) for x in raw_t if isinstance(x, str) and x.strip()}
        if not targets:
            admin_spy_watch_targets.pop(sid_k, None)
        else:
            admin_spy_watch_targets[sid_k] = targets
    if not isinstance(raw_r, list):
        admin_spy_watch_rooms.pop(sid_k, None)
    else:
        rooms = {str(x) for x in raw_r if isinstance(x, str) and x.strip()}
        if not rooms:
            admin_spy_watch_rooms.pop(sid_k, None)
        else:
            admin_spy_watch_rooms[sid_k] = rooms


@sio.event
async def admin_spy_request(sid, data):
    target_sid = data.get('target_sid')
    if target_sid in online_users:
        await sio.emit('spy_request', {'admin_sid': sid}, to=target_sid)

@sio.event
async def spy_offer(sid, data):
    admin_sid = data.get('admin_sid')
    if admin_sid:
        data['target_sid'] = sid
        await sio.emit('spy_offer', data, to=admin_sid)

@sio.event
async def spy_answer(sid, data):
    target_sid = data.get('target_sid')
    if target_sid:
        data['admin_sid'] = sid
        await sio.emit('spy_answer', data, to=target_sid)

@sio.event
async def spy_ice_candidate(sid, data):
    to_sid = data.get('to_sid')
    if to_sid:
        data['from_sid'] = sid
        await sio.emit('spy_ice_candidate', data, to=to_sid)
