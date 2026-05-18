import { socket } from '../sockets/socket';
import { useAppStore } from '../store/useAppStore';
import { buildMatchmakingFilters } from '../types/matchZone';
import { resolveMatchmakingUserId } from './matchmakingUserId';

/** Registra al usuario en la cola de la sala (`matchZone`) elegida en el store. */
export function emitStartMatchmaking(): void {
  const s = useAppStore.getState();
  socket.emit('start_matchmaking', {
    user_id: resolveMatchmakingUserId(),
    role: s.role,
    filters: buildMatchmakingFilters(s.matchZone),
  });
}
