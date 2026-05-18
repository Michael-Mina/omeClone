import { apiUrl } from '../config/apiBase';
import { useAppStore } from '../store/useAppStore';

let refreshPromise: Promise<string | null> | null = null;

async function probeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
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

/**
 * Devuelve un JWT válido para llamadas REST.
 * Si el anónimo fue borrado en el servidor (p. ej. tras cerrar pestaña), crea uno nuevo con el perfil guardado.
 */
export async function ensureValidAccessToken(options?: {
  forceRefresh?: boolean;
}): Promise<string | null> {
  const st = useAppStore.getState();
  const current = st.token?.trim();
  if (!current) return null;

  if (!options?.forceRefresh && (await probeToken(current))) {
    return current;
  }

  if (!st.isAnonymous) {
    useAppStore.getState().setAuth('', '', 'user', null, false);
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshAnonymousSession().finally(() => {
      refreshPromise = null;
    });
  }
  const fresh = await refreshPromise;
  if (fresh) return fresh;

  useAppStore.getState().setAuth('', '', 'user', null, false);
  return null;
}
