import { apiUrl } from '../config/apiBase';
import { useAppStore } from '../store/useAppStore';

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefreshToken(expiredToken: string): Promise<string | null> {
  try {
    const r = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { access_token?: string };
    const next = typeof data.access_token === 'string' ? data.access_token.trim() : '';
    return next || null;
  } catch {
    return null;
  }
}

async function tryAnonymousReLogin(): Promise<string | null> {
  const s = useAppStore.getState();
  if (!s.isAnonymous || !s.gender || !s.country || !s.language || !s.birthYear) {
    return null;
  }
  try {
    const r = await fetch(apiUrl('/api/auth/anonymous-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birth_year: s.birthYear,
        gender: s.gender,
        country: s.country,
        language: s.language,
        adult_declaration: true,
      }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      access_token?: string;
      user_id?: number;
      display_name?: string | null;
      exempt_from_ai_censorship?: boolean;
    };
    const next = typeof data.access_token === 'string' ? data.access_token.trim() : '';
    if (!next) return null;
    s.setAuth(
      String(data.user_id ?? s.userId ?? 'anon'),
      next,
      'user',
      data.display_name ?? s.displayName,
      true,
      {
        gender: s.gender,
        country: s.country,
        language: s.language,
        birthYear: s.birthYear,
        exemptFromAiCensorship: Boolean(data.exempt_from_ai_censorship),
      }
    );
    return next;
  } catch {
    return null;
  }
}

/**
 * Devuelve un Bearer válido para REST: reutiliza el actual, renueva con /refresh
 * o vuelve a crear sesión anónima si el usuario ya no existe en el servidor.
 */
export async function ensureFreshToken(): Promise<string | null> {
  const tok = useAppStore.getState().token?.trim();
  if (!tok) return null;

  try {
    const r = await fetch(apiUrl('/api/auth/me'), { headers: { Authorization: `Bearer ${tok}` } });
    if (r.ok) return tok;
  } catch {
    /* red caída: intentar refresh igual */
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        let next = await tryRefreshToken(tok);
        if (!next) next = await tryAnonymousReLogin();
        if (next) useAppStore.getState().updateAccessToken(next);
        return next;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}
