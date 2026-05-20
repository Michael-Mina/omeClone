import { apiUrl } from '../config/apiBase';
import { useAppStore } from '../store/useAppStore';

let refreshPromise: Promise<string | null> | null = null;

/** Resultado de GET /api/auth/me para decidir si renovar JWT o conservar sesión (p. ej. baneo). */
type MeProbe = 'ok' | 'unauth' | 'forbidden' | 'error';

async function probeMe(token: string): Promise<MeProbe> {
  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return 'ok';
    if (res.status === 403) return 'forbidden';
    if (res.status === 401) return 'unauth';
    return 'unauth';
  } catch {
    return 'error';
  }
}

async function tryJwtRefresh(token: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    const next = typeof data.access_token === 'string' ? data.access_token.trim() : '';
    if (!next) return null;
    useAppStore.getState().updateAccessToken(next);
    return next;
  } catch {
    return null;
  }
}

async function refreshAnonymousSession(): Promise<string | null> {
  const st = useAppStore.getState();
  if (
    !st.isAnonymous ||
    !st.birthYear ||
    !st.gender ||
    !st.country ||
    !st.language
  ) {
    return null;
  }

  try {
    const res = await fetch(apiUrl('/api/auth/anonymous-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birth_year: st.birthYear,
        gender: st.gender,
        country: st.country,
        language: st.language,
        adult_declaration: true,
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      user_id?: number;
      display_name?: string | null;
      exempt_from_ai_censorship?: boolean;
    };
    if (!res.ok || !data.access_token) {
      console.warn('[auth] No se pudo renovar sesión anónima', res.status);
      return null;
    }

    useAppStore.getState().setAuth(
      String(data.user_id ?? ''),
      data.access_token,
      'user',
      data.display_name ?? st.displayName,
      true,
      {
        gender: st.gender,
        country: st.country,
        language: st.language,
        birthYear: st.birthYear,
        exemptFromAiCensorship: Boolean(data.exempt_from_ai_censorship),
      }
    );
    return data.access_token;
  } catch (err) {
    console.warn('[auth] Error renovando sesión anónima', err);
    return null;
  }
}

async function renewAccessToken(
  current: string,
  options?: { forceRefresh?: boolean }
): Promise<string | null> {
  if (!options?.forceRefresh) {
    const probe = await probeMe(current);
    if (probe === 'ok') return current;
    // 403 en /me (despliegues antiguos) o fallo de red: no tratar como token inválido
    // ni crear otro usuario anónimo (evita “perder” el baneo al recargar).
    if (probe === 'forbidden' || probe === 'error') return current;
  }

  const refreshed = await tryJwtRefresh(current);
  if (refreshed) {
    const p = await probeMe(refreshed);
    if (p === 'ok') return refreshed;
    if (p === 'forbidden' || p === 'error') return refreshed;
  }

  const st = useAppStore.getState();
  if (st.isAnonymous) {
    return refreshAnonymousSession();
  }

  return null;
}

/**
 * Devuelve un JWT válido para llamadas REST.
 * Renueva con /auth/refresh o, si el anónimo fue borrado, vuelve a crear sesión.
 */
export async function ensureValidAccessToken(options?: {
  forceRefresh?: boolean;
}): Promise<string | null> {
  const current = useAppStore.getState().token?.trim();
  if (!current) return null;

  if (!refreshPromise) {
    refreshPromise = renewAccessToken(current, options).finally(() => {
      refreshPromise = null;
    });
  }

  const fresh = await refreshPromise;
  if (fresh) return fresh;

  useAppStore.getState().setAuth('', '', 'user', null, false);
  return null;
}

/** Alias usado en App.tsx (misma lógica que ensureValidAccessToken). */
export const ensureFreshToken = ensureValidAccessToken;
