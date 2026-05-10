import { socket } from '../sockets/socket';
import { resolveUserIdForIdentify } from './resolveSocketUserId';

/** Misma resolución que `identify`: evita usar solo socket.id si ya hay JWT/persist con `sub` o userId. */
export function resolveMatchmakingUserId(): string {
  return resolveUserIdForIdentify(socket.id);
}
