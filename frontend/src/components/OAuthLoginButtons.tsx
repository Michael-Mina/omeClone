import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiUrl } from '../config/apiBase';
import {
  GENDER_OPTIONS,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  getBirthYearsDescending,
} from '../data/profileOptions';

export type OAuthTokenPayload = {
  access_token: string;
  is_superuser?: boolean;
  user_id?: number;
  display_name?: string | null;
  exempt_from_ai_censorship?: boolean;
};

type OAuthProviders = {
  google: { enabled: boolean; client_id: string | null };
};

type PendingOAuth = { provider: 'google'; credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: Record<string, unknown>) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** Misma base que «Entrar como Anónimo» en Login.tsx */
const BTN_MATCH_ANONYMOUS_BASE =
  'w-full bg-gray-800/80 text-white font-medium py-3.5 px-4 rounded-xl border border-gray-700 transition-all shadow-md flex items-center justify-center gap-2';

const BTN_MATCH_ANONYMOUS = `${BTN_MATCH_ANONYMOUS_BASE} hover:bg-gray-700`;

/** Capa visible bajo el iframe GIS: el hover lo recibe el grupo (el usuario pasa el ratón por la capa invisible). */
const BTN_GOOGLE_UNDERLAY = `${BTN_MATCH_ANONYMOUS_BASE} pointer-events-none select-none transition-colors group-hover:bg-gray-700`;

/** Logo Google multicolor oficial (sin caja blanca), sobre fondo oscuro. */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function isProfileRequired(data: unknown): boolean {
  const d = (data as { detail?: { code?: string } | string }).detail;
  return typeof d === 'object' && d !== null && 'code' in d && (d as { code: string }).code === 'oauth_profile_required';
}

function detailMessage(data: unknown): string {
  const d = (data as { detail?: { message?: string; code?: string } | string }).detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && 'message' in d) return String((d as { message: string }).message);
  return 'Error';
}

const DISABLED_GOOGLE_HINT =
  'Google no está activo en el servidor. En Render (API), define GOOGLE_OAUTH_CLIENT_IDS con el ID de cliente OAuth Web y reinicia.';

export function OAuthLoginButtons({
  onSuccess,
  disabled,
}: {
  onSuccess: (data: OAuthTokenPayload) => void;
  disabled?: boolean;
}) {
  const [providers, setProviders] = useState<OAuthProviders | null>(null);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [pending, setPending] = useState<PendingOAuth | null>(null);
  const [gsiReady, setGsiReady] = useState(false);

  /** Contenedor para medir ancho y alinear capa decorativa + GIS encima. */
  const googleOverlayWrapRef = useRef<HTMLDivElement>(null);
  const googleHiddenHostRef = useRef<HTMLDivElement>(null);

  const [birthYear, setBirthYear] = useState(0);
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const [adultConfirmed, setAdultConfirmed] = useState(false);

  const birthYears = getBirthYearsDescending();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(apiUrl('/api/auth/oauth/providers'));
        if (cancelled) return;
        if (!r.ok) {
          setProviders({ google: { enabled: false, client_id: null } });
          setProvidersLoaded(true);
          return;
        }
        const j = (await r.json()) as OAuthProviders & Record<string, unknown>;
        if (!cancelled) {
          setProviders({
            google: j.google ?? { enabled: false, client_id: null },
          });
          setProvidersLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setProviders({ google: { enabled: false, client_id: null } });
          setProvidersLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyToken = useCallback(
    (raw: unknown) => {
      const data = raw as OAuthTokenPayload & Record<string, unknown>;
      if (!data?.access_token) return;
      onSuccess({
        access_token: data.access_token,
        is_superuser: Boolean(data.is_superuser),
        user_id: typeof data.user_id === 'number' ? data.user_id : undefined,
        display_name: data.display_name ?? null,
        exempt_from_ai_censorship: Boolean(data.exempt_from_ai_censorship),
      });
    },
    [onSuccess],
  );

  const postGoogle = useCallback(
    async (credential: string, extras?: Record<string, unknown>) => {
      setLoading(true);
      try {
        const body: Record<string, unknown> = { credential, ...extras };
        const res = await fetch(apiUrl('/api/auth/oauth/google'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          applyToken(data);
          setShowProfile(false);
          setPending(null);
          return;
        }
        if (res.status === 400 && isProfileRequired(data)) {
          setPending({ provider: 'google', credential });
          setShowProfile(true);
          return;
        }
        alert(detailMessage(data));
      } catch {
        alert('Error de conexión');
      } finally {
        setLoading(false);
      }
    },
    [applyToken],
  );

  useEffect(() => {
    if (!providers?.google.enabled || !providers.google.client_id) {
      setGsiReady(false);
      return;
    }

    const clientId = providers.google.client_id;
    let cancelled = false;

    const renderHiddenGoogleButton = () => {
      const host = googleHiddenHostRef.current;
      if (cancelled || !host || !window.google?.accounts?.id) return;
      host.innerHTML = '';
      setGsiReady(false);

      const wrapW = googleOverlayWrapRef.current?.offsetWidth ?? 360;
      const widthPx = Math.min(520, Math.max(260, Math.round(wrapW)));

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential?: string }) => {
          if (resp.credential) void postGoogle(resp.credential);
        },
        auto_select: false,
      });

      window.google.accounts.id.renderButton(host, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        locale: 'es',
        width: widthPx,
      });

      window.setTimeout(() => {
        if (!cancelled) setGsiReady(true);
      }, 400);
    };

    const scheduleRender = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => renderHiddenGoogleButton());
      });
    };

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing && window.google?.accounts?.id) {
      scheduleRender();
    } else if (existing) {
      existing.addEventListener('load', scheduleRender);
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => scheduleRender();
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      setGsiReady(false);
      if (googleHiddenHostRef.current) googleHiddenHostRef.current.innerHTML = '';
    };
  }, [providers?.google.enabled, providers?.google.client_id, postGoogle]);

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    if (!adultConfirmed) {
      alert('Debes confirmar que tienes 18 años o más.');
      return;
    }
    if (!birthYear || !gender || !country || !language) {
      alert('Completa año, género, país e idioma.');
      return;
    }
    const extras = {
      birth_year: birthYear,
      gender,
      country,
      language,
      adult_declaration: true,
    };
    void postGoogle(pending.credential, extras);
  };

  const closeModal = () => {
    setShowProfile(false);
    setPending(null);
  };

  const googleLive = Boolean(providers?.google.enabled && providers.google.client_id);
  const showOAuthHint = providersLoaded && !googleLive;

  const overlayBlocked = disabled || loading || !gsiReady;

  return (
    <>
      <div className="w-full flex flex-col items-stretch gap-2">
        {!providersLoaded ? (
          <div className="h-[52px] w-full rounded-xl bg-gray-800/80 animate-pulse" aria-hidden />
        ) : (
          <>
            {googleLive ? (
              <div
                ref={googleOverlayWrapRef}
                className={`group relative w-full min-h-[52px] ${disabled || loading ? 'opacity-50' : ''}`}
              >
                {/* Misma pintura que «Anónimo» (solo decoración; el clic lo captura GIS encima). */}
                <div className={BTN_GOOGLE_UNDERLAY} aria-hidden>
                  <GoogleMark className="h-5 w-5 shrink-0" />
                  Continuar con Google
                </div>
                <div
                  ref={googleHiddenHostRef}
                  className={`absolute inset-0 z-10 flex min-h-[52px] w-full items-center justify-center opacity-0 [&_*]:max-w-none ${overlayBlocked ? 'pointer-events-none' : ''}`}
                  aria-hidden
                />
              </div>
            ) : (
              <button
                type="button"
                disabled
                title={DISABLED_GOOGLE_HINT}
                className={`${BTN_MATCH_ANONYMOUS} opacity-60 cursor-not-allowed`}
              >
                <GoogleMark className="h-5 w-5 shrink-0 opacity-70" />
                Continuar con Google
              </button>
            )}
          </>
        )}
      </div>
      {showOAuthHint && (
        <p className="mt-2 text-center text-[11px] text-amber-200/90 leading-snug max-w-md mx-auto px-1">
          Google OAuth no está configurado en la API: el botón está desactivado hasta que en Render definas{' '}
          <span className="font-mono">GOOGLE_OAUTH_CLIENT_IDS</span> y vuelvas a desplegar.
        </p>
      )}

      {showProfile && pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative max-w-lg w-full bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 md:p-8">
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
            <h3 className="text-xl font-bold text-white pr-10">Completa tu perfil</h3>
            <p className="text-sm text-gray-400 mt-1 mb-5">
              Para crear tu cuenta necesitamos estos datos (solo la primera vez).
            </p>
            <form onSubmit={submitProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Año de nacimiento
                </label>
                <select
                  value={birthYear || ''}
                  onChange={(e) => setBirthYear(Number(e.target.value) || 0)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Selecciona…</option>
                  {birthYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Género
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {GENDER_OPTIONS.map((o) => (
                    <option key={o.value || 'placeholder'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">País</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {COUNTRY_OPTIONS.map((o) => (
                    <option key={o.value || 'ph'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Idioma
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.value || 'ph'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={adultConfirmed}
                  onChange={(e) => setAdultConfirmed(e.target.checked)}
                  className="mt-1 rounded border-gray-600 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <span className="text-sm text-gray-300 leading-snug group-hover:text-white transition-colors">
                  Confirmo que tengo <strong className="text-white">18 años cumplidos o más</strong>.
                </span>
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 rounded-xl disabled:opacity-50"
              >
                {loading ? 'Creando cuenta…' : 'Continuar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
