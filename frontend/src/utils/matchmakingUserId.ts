import { socket } from '../sockets/socket';
import { useAppStore } from '../store/useAppStore';

/** userId vacío no es nullish: hay que usar trim + fallback a socket.id para cola e identify. */
export function resolveMatchmakingUserId(): string {
  const raw = useAppStore.getState().userId?.trim();
  if (raw) return raw;
  return socket.id ?? 'anonymous';
}
