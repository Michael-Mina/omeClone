import { useAppStore } from '../store/useAppStore';
import { jwtSubjectFromToken, readPersistedOmetvSnapshot } from './persistedAuthSnapshot';

/**
 * userId estable para `identify` y matchmaking: store → persist localStorage → sub del JWT → socket/bulto.
 * Corrige la carrera donde el socket conecta antes de que Zustand rehidrate (anónimos quedaban como socket.id → sin exenciones en admin).
 */
export function resolveUserIdForIdentify(socketId: string | null | undefined): string {
  const st = useAppStore.getState();
  const snap = readPersistedOmetvSnapshot();
  const fromStore = (st.userId ?? '').trim();
  const fromSnap = (snap.userId ?? '').trim();
  if (fromStore) return fromStore;
  if (fromSnap) return fromSnap;

  const tok = st.token || snap.token;
  const sub = jwtSubjectFromToken(tok);
  if (sub) return sub;

  const sid = (socketId ?? '').trim();
  if (sid) return sid;
  return 'anonymous';
}
