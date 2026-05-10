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
  facebook: { enabled: boolean; app_id: string | null };
};

type PendingOAuth =
  | { provider: 'google'; credential: string }
  | { provider: 'facebook'; access_token: string };

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
    FB?: {
      init: (cfg: Record<string, unknown>) => void;
      login: (cb: (r: Record<string, unknown>) => void, opts?: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
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

export function OAuthLoginButtons({
  onSuccess,
  disabled,
}: {
  onSuccess: (data: OAuthTokenPayload) => void;
  disabled?: boolean;
}) {
  const [providers, setProviders] = useState<OAuthProviders | null>(null);
  const [loading, setLoading] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [pending, setPending] = useState<PendingOAuth | null>(null);
  const [fbReady, setFbReady] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

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
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as OAuthProviders;
        if (!cancelled) setProviders(j);
      } catch {
        /* ignore */
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

  const postFacebook = useCallback(
    async (access_token: string, extras?: Record<string, unknown>) => {
      setLoading(true);
      try {
        const body: Record<string, unknown> = { access_token, ...extras };
        const res = await fetch(apiUrl('/api/auth/oauth/facebook'), {
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
          setPending({ provider: 'facebook', access_token });
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
    if (!providers?.google.enabled || !providers.google.client_id) return;

    const clientId = providers.google.client_id;
    let cancelled = false;

    const renderGoogleButton = () => {
      if (cancelled || !googleBtnRef.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp: { credential?: string }) => {
          if (resp.credential) void postGoogle(resp.credential);
        },
        auto_select: false,
      });
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'medium',
        text: 'continue_with',
        shape: 'pill',
        locale: 'es',
        width: 280,
      });
    };

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing && window.google?.accounts?.id) {
      renderGoogleButton();
    } else if (existing) {
      existing.addEventListener('load', renderGoogleButton);
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => renderGoogleButton();
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (googleBtnRef.current) googleBtnRef.current.innerHTML = '';
    };
  }, [providers?.google.enabled, providers?.google.client_id, postGoogle]);

  useEffect(() => {
    if (!providers?.facebook.enabled || !providers.facebook.app_id) return;

    const appId = providers.facebook.app_id;

    window.fbAsyncInit = () => {
      if (!window.FB) return;
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      });
      setFbReady(true);
    };

    if (document.getElementById('facebook-jssdk')) {
      if (window.FB) {
        window.FB.init({
          appId,
          cookie: true,
          xfbml: false,
          version: 'v21.0',
        });
        setFbReady(true);
      }
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = 'https://connect.facebook.net/es_ES/sdk.js';
    document.body.appendChild(script);
  }, [providers?.facebook.enabled, providers?.facebook.app_id]);

  const handleFacebookClick = () => {
    if (!window.FB || !fbReady) {
      alert('Facebook SDK aún no está listo. Espera un momento e inténtalo de nuevo.');
      return;
    }
    window.FB.login(
      (response: Record<string, unknown>) => {
        const auth = response.authResponse as { accessToken?: string } | undefined;
        const token = auth?.accessToken;
        if (token) void postFacebook(token);
      },
      { scope: 'public_profile,email' },
    );
  };

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
    if (pending.provider === 'google') void postGoogle(pending.credential, extras);
    else void postFacebook(pending.access_token, extras);
  };

  const closeModal = () => {
    setShowProfile(false);
    setPending(null);
  };

  if (!providers || (!providers.google.enabled && !providers.facebook.enabled)) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 justify-center">
        {providers.google.enabled && providers.google.client_id && (
          <div
            className={`flex justify-center min-h-[40px] ${disabled || loading ? 'opacity-50 pointer-events-none' : ''}`}
            ref={googleBtnRef}
          />
        )}
        {providers.facebook.enabled && providers.facebook.app_id && (
          <button
            type="button"
            disabled={disabled || loading || !fbReady}
            onClick={handleFacebookClick}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1877F2] bg-[#1877F2]/15 hover:bg-[#1877F2]/25 text-white text-sm font-semibold px-4 py-2 min-h-[40px] transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Continuar con Facebook
          </button>
        )}
      </div>

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
