import uuid

# Colas por sala: moderated (IA + sanciones) | adult (+18, sin ambas)
waiting_queues: dict[str, list] = {
    "moderated": [],
    "adult": [],
}

VALID_MATCH_ZONES = frozenset({"moderated", "adult"})


def _is_anonymous_id(uid) -> bool:
    """Varios clientes envían user_id 'anonymous' o null: no deben tratarse como la misma cuenta."""
    if uid is None:
        return True
    s = str(uid).strip().lower()
    return s in ("", "anonymous", "none")


def normalize_match_zone(filters: dict | None) -> str:
    z = (filters or {}).get("match_zone") or "moderated"
    s = str(z).strip().lower()
    return s if s in VALID_MATCH_ZONES else "moderated"


class MatchmakingService:
    @staticmethod
    async def find_match_or_wait(user_id: str, sid: str, filters: dict = None):
        """
        Busca un usuario en espera en la misma sala. Si lo encuentra, retorna match.
        Si no, coloca al usuario en la cola de esa sala.
        """
        # Un mismo socket no puede estar en dos colas a la vez (evita dobles entradas / spam).
        for z in VALID_MATCH_ZONES:
            waiting_queues[z] = [u for u in waiting_queues[z] if u["sid"] != sid]

        zone = normalize_match_zone(filters)
        queue = waiting_queues[zone]

        if _is_anonymous_id(user_id):
            waiting_queues[zone] = [u for u in queue if u["sid"] != sid]
        else:
            uid_s = str(user_id).strip()
            waiting_queues[zone] = [u for u in queue if str(u.get("user_id")) != uid_s]
        queue = waiting_queues[zone]

        if len(queue) > 0:
            waiting_user = queue.pop(0)
            waiting_sid = waiting_user["sid"]
            waiting_id = waiting_user["user_id"]

            room_id = f"room_{uuid.uuid4().hex}"
            return {
                "matched": True,
                "room_id": room_id,
                "peer_sid": waiting_sid,
                "peer_id": waiting_id,
                "match_zone": zone,
            }

        waiting_queues[zone].append({"user_id": user_id, "sid": sid, "match_zone": zone})

        return {"matched": False, "match_zone": zone}

    @staticmethod
    async def remove_from_queue(sid: str):
        for zone in VALID_MATCH_ZONES:
            waiting_queues[zone] = [user for user in waiting_queues[zone] if user["sid"] != sid]
