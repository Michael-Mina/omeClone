import uuid

# In-memory queue instead of Redis para no depender de Docker
waiting_queue = []


def _is_anonymous_id(uid) -> bool:
    """Varios clientes envían user_id 'anonymous' o null: no deben tratarse como la misma cuenta."""
    if uid is None:
        return True
    s = str(uid).strip().lower()
    return s in ("", "anonymous", "none")


class MatchmakingService:
    @staticmethod
    async def find_match_or_wait(user_id: str, sid: str, filters: dict = None):
        """
        Busca un usuario en espera. Si lo encuentra, retorna un match (room_id, peer_sid).
        Si no, coloca al usuario en la lista de espera.
        """
        global waiting_queue

        # Quitar entradas duplicadas del mismo usuario registrado (otra pestaña / reintento).
        # Si user_id es 'anonymous' genérico, NO vaciar la cola: solo quitar la propia entrada por sid.
        if _is_anonymous_id(user_id):
            waiting_queue = [u for u in waiting_queue if u["sid"] != sid]
        else:
            uid_s = str(user_id).strip()
            waiting_queue = [u for u in waiting_queue if str(u.get("user_id")) != uid_s]
        
        if len(waiting_queue) > 0:
            # Hay alguien esperando
            waiting_user = waiting_queue.pop(0)
            waiting_sid = waiting_user['sid']
            waiting_id = waiting_user['user_id']
            
            room_id = f"room_{uuid.uuid4().hex}"
            return {
                "matched": True,
                "room_id": room_id,
                "peer_sid": waiting_sid,
                "peer_id": waiting_id
            }
                
        # Si no hay nadie, me pongo en la cola
        waiting_queue.append({"user_id": user_id, "sid": sid})
        
        return {"matched": False}

    @staticmethod
    async def remove_from_queue(sid: str):
        global waiting_queue
        waiting_queue = [user for user in waiting_queue if user['sid'] != sid]
