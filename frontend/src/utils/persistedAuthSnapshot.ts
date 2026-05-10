/** Clave de `persist` en useAppStore — debe coincidir con `name` del store. */
export const OMETV_AUTH_STORAGE_KEY = 'ometv-auth';

export type PersistedAuthSnap = { userId: string | null; token: string | null };

/**
 * Lee userId/token del snapshot en localStorage sin esperar a que Zustand rehidrate.
 * Evita `identify` con `socket.id` cuando la sesión ya existe (anónimos/registrados).
 */
export function readPersistedOmetvSnapshot(): PersistedAuthSnap {
  if (typeof localStorage === 'undefined') return { userId: null, token: null };
  try {
    const raw = localStorage.getItem(OMETV_AUTH_STORAGE_KEY);
    if (!raw) return { userId: null, token: null };
    const parsed = JSON.parse(raw) as { state?: { userId?: unknown; token?: unknown } };
    const st = parsed?.state;
    const userId = typeof st?.userId === 'string' && st.userId.trim() ? st.userId.trim() : null;
    const token = typeof st?.token === 'string' && st.token ? st.token : null;
    return { userId, token };
  } catch {
    return { userId: null, token: null };
  }
}

/** Claim `sub` del JWT (solo lectura local; no valida firma). */
export function jwtSubjectFromToken(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(json) as { sub?: unknown };
    const sub = payload.sub;
    if (typeof sub === 'string' && sub.trim()) return sub.trim();
    if (typeof sub === 'number' && Number.isFinite(sub)) return String(sub);
    return null;
  } catch {
    return null;
  }
}
