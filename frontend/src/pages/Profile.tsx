import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { User, LogOut, LogIn, ShieldCheck, Loader2, Crown, MessageSquare } from 'lucide-react';
import {
  GENDER_OPTIONS,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  getBirthYearsDescending,
  MIN_AGE,
} from '../data/profileOptions';
import { apiUrl } from '../config/apiBase';

type MeJson = {
  id: number;
  email?: string | null;
  display_name?: string | null;
  gender?: string | null;
  country?: string | null;
  language?: string | null;
  birth_year?: number | null;
  is_superuser?: boolean;
  is_premium?: boolean;
  premium_source?: string | null;
};

type ProfileBaseline = {
  display_name: string;
  gender: string;
  country: string;
  language: string;
  birth_year: number;
};

export default function Profile() {
  const navigate = useNavigate();
  const { userId, displayName, role, isAnonymous, isPremium, setAuth, token, salaSessionActive } =
    useAppStore();

  const name = displayName || (isAnonymous ? 'Anónimo' : 'Usuario');
  const initial = (name.trim()[0] || 'U').toUpperCase();

  const [email, setEmail] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const [birthYear, setBirthYear] = useState<number>(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [profileLoading, setProfileLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);
  /** Valores tal como vienen del servidor; solo se comparan al guardar para armar un PATCH parcial. */
  const [baseline, setBaseline] = useState<ProfileBaseline | null>(null);
  const [suggestionText, setSuggestionText] = useState('');
  const [suggestionSending, setSuggestionSending] = useState(false);
  const [suggestionOk, setSuggestionOk] = useState<string | null>(null);

  const birthYears = useMemo(() => getBirthYearsDescending(), []);

  const snapshotFromMe = useCallback(
    (data: MeJson): ProfileBaseline => ({
      display_name: (data.display_name ?? '').trim(),
      gender: data.gender ?? '',
      country: data.country ?? '',
      language: data.language ?? '',
      birth_year:
        data.birth_year != null && birthYears.includes(data.birth_year) ? data.birth_year : 0,
    }),
    [birthYears]
  );

  useEffect(() => {
    if (isAnonymous || !token) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      setProfileLoading(true);
      try {
        const res = await fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as MeJson & { detail?: unknown };
        if (!res.ok) {
          const msg =
            typeof data.detail === 'string'
              ? data.detail
              : 'No se pudo cargar el perfil. Vuelve a iniciar sesión.';
          throw new Error(msg);
        }
        if (cancelled) return;
        setEmail(data.email ?? '');
        setEditDisplayName(data.display_name ?? '');
        setGender(data.gender ?? '');
        setCountry(data.country ?? '');
        setLanguage(data.language ?? '');
        setBirthYear(data.birth_year && birthYears.includes(data.birth_year) ? data.birth_year : 0);
        setBaseline(snapshotFromMe(data));
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : 'Error al cargar');
          setBaseline(null);
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAnonymous, token, snapshotFromMe]);

  const logout = () => {
    setAuth('', '', 'user', null, false);
    navigate('/login');
  };

  const submitSuggestion = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSuggestionOk(null);
    const text = suggestionText.trim();
    if (!token) {
      navigate('/login');
      return;
    }
    if (text.length < 10) {
      alert('Escribe al menos 10 caracteres.');
      return;
    }
    setSuggestionSending(true);
    try {
      const res = await fetch(apiUrl('/api/suggestions'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
      if (!res.ok) {
        alert(typeof data.detail === 'string' ? data.detail : 'No se pudo enviar la sugerencia');
        return;
      }
      setSuggestionText('');
      setSuggestionOk('¡Gracias! Tu sugerencia llegó al equipo.');
    } catch {
      alert('Error de conexión al enviar');
    } finally {
      setSuggestionSending(false);
    }
  };

  const applyMeToStore = (data: MeJson) => {
    const st = useAppStore.getState();
    if (!st.token) return;
    setAuth(String(data.id), st.token, data.is_superuser ? 'superadmin' : 'user', data.display_name ?? null, false, {
      gender: data.gender ?? null,
      country: data.country ?? null,
      language: data.language ?? null,
      birthYear: data.birth_year ?? null,
      exemptFromAiCensorship: st.exemptFromAiCensorship,
      isPremium: Boolean(data.is_premium),
      premiumSource: typeof data.premium_source === 'string' ? data.premium_source : null,
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveOk(null);
    if (!token) return;
    if (!baseline) {
      alert('Espera a que termine de cargar el perfil.');
      return;
    }

    const patch: Record<string, unknown> = {};

    const dn = editDisplayName.trim();
    if (dn !== baseline.display_name) {
      patch.display_name = dn;
    }
    if (gender !== baseline.gender) {
      patch.gender = gender;
    }
    if (country !== baseline.country) {
      patch.country = country;
    }
    if (language !== baseline.language) {
      patch.language = language;
    }
    if (birthYear !== baseline.birth_year) {
      patch.birth_year = birthYear;
    }

    const wantsPasswordChange = !!(newPassword || currentPassword || confirmPassword);
    if (wantsPasswordChange) {
      if (!currentPassword || !newPassword) {
        alert('Para cambiar la contraseña, escribe la actual y la nueva.');
        return;
      }
      if (newPassword !== confirmPassword) {
        alert('La nueva contraseña y la confirmación no coinciden.');
        return;
      }
      if (newPassword.length < 6) {
        alert('La nueva contraseña debe tener al menos 6 caracteres.');
        return;
      }
      patch.current_password = currentPassword;
      patch.new_password = newPassword;
    }

    if ('display_name' in patch && !String(patch.display_name).trim()) {
      alert('El nombre para mostrar no puede quedar vacío.');
      return;
    }
    if ('gender' in patch && !gender) {
      alert('Selecciona un género.');
      return;
    }
    if ('country' in patch && !country) {
      alert('Selecciona un país.');
      return;
    }
    if ('language' in patch && !language) {
      alert('Selecciona un idioma.');
      return;
    }
    if ('birth_year' in patch) {
      if (!birthYear || !birthYears.includes(birthYear)) {
        alert('Selecciona un año de nacimiento válido.');
        return;
      }
    }

    if (Object.keys(patch).length === 0) {
      alert('No hay cambios que guardar.');
      return;
    }

    setSaveLoading(true);
    try {
      const res = await fetch(apiUrl('/api/auth/me'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(typeof data.detail === 'string' ? data.detail : 'No se pudieron guardar los cambios');
        return;
      }
      const me = data as MeJson;
      applyMeToStore(me);
      setEmail(me.email ?? '');
      setEditDisplayName(me.display_name ?? '');
      setGender(me.gender ?? '');
      setCountry(me.country ?? '');
      setLanguage(me.language ?? '');
      setBirthYear(me.birth_year && birthYears.includes(me.birth_year) ? me.birth_year : 0);
      setBaseline(snapshotFromMe(me));
      setSaveOk('Cambios guardados.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      alert('Error de conexión con el servidor');
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-900/30 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-900/30 rounded-full blur-3xl"></div>

      <div className="max-w-2xl mx-auto p-6 md:p-10">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <User size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">Perfil</h1>
              <p className="text-sm text-gray-400">Gestiona tu cuenta y accesos.</p>
            </div>
          </div>
          <Link
            to={role === 'superadmin' ? '/admin' : salaSessionActive ? '/app' : '/salas'}
            className="text-sm font-semibold text-gray-300 hover:text-white bg-gray-900/70 border border-gray-800 px-4 py-2 rounded-full transition-colors"
          >
            Volver
          </Link>
        </header>

        <div className="bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-3xl shadow-2xl overflow-hidden">
          <div className="p-6 md:p-8 flex items-center gap-5 border-b border-gray-800">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-purple-500/20">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white truncate">{name}</h2>
                {role === 'superadmin' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-full bg-amber-500 text-black">
                    <ShieldCheck size={12} /> SUPERADMIN
                  </span>
                )}
                {isAnonymous && (
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700">
                    ANÓNIMO
                  </span>
                )}
                {isPremium && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    <Crown size={12} /> PREMIUM
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-1">
                ID: <span className="font-mono text-gray-300">{userId || '—'}</span>
              </p>
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-4">
            {isAnonymous ? (
              <div className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5">
                <p className="text-sm text-gray-300 font-semibold">Estás usando una sesión anónima.</p>
                <p className="text-sm text-gray-400 mt-1">
                  Para una cuenta persistente usa <strong className="text-gray-200">Iniciar sesión con Google</strong> desde la
                  pantalla de entrada; podrás editar perfil al iniciar sesión.
                </p>

                <div className="mt-4">
                  <button
                    onClick={() => navigate('/login')}
                    className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-95"
                  >
                    <LogIn size={18} /> Ir al inicio de sesión
                  </button>
                </div>
              </div>
            ) : !token ? (
              <div className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5 text-sm text-gray-400">
                No hay sesión activa.{' '}
                <button type="button" className="text-blue-400 font-semibold hover:underline" onClick={() => navigate('/login')}>
                  Inicia sesión
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-6">
                {loadError && (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{loadError}</div>
                )}
                {saveOk && (
                  <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{saveOk}</div>
                )}

                {profileLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                    <Loader2 className="animate-spin" size={20} />
                    Cargando datos…
                  </div>
                ) : (
                  <>
                    {!isAnonymous && (
                      <div className="bg-gradient-to-br from-amber-950/40 to-gray-950/40 border border-amber-900/40 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-amber-200 uppercase tracking-wide flex items-center gap-2">
                            <Crown size={16} /> Albedrío Premium
                          </h3>
                          <p className="text-xs text-gray-400 mt-1">
                            {isPremium
                              ? 'Tienes beneficios Premium activos.'
                              : 'Suscripción mensual con funciones exclusivas.'}
                          </p>
                        </div>
                        <Link
                          to="/premium"
                          className="text-sm font-semibold px-4 py-2 rounded-xl bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
                        >
                          {isPremium ? 'Gestionar' : 'Ver planes'}
                        </Link>
                      </div>
                    )}

                    <div className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide">Cuenta</h3>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Correo</label>
                        <input
                          type="email"
                          readOnly
                          value={email}
                          className="w-full rounded-xl bg-gray-900/80 border border-gray-800 px-3 py-2.5 text-sm text-gray-400 cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Nombre para mostrar</label>
                        <input
                          type="text"
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                          autoComplete="nickname"
                        />
                      </div>
                    </div>

                    <div className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide">Datos personales</h3>
                      <p className="text-xs text-gray-500">
                        Género, país, idioma y año de nacimiento (mayoría de edad: {MIN_AGE}+).
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Género</label>
                          <select
                            value={gender}
                            onChange={(e) => setGender(e.target.value)}
                            className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                          >
                            {GENDER_OPTIONS.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">País</label>
                          <select
                            value={country}
                            onChange={(e) => setCountry(e.target.value)}
                            className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                          >
                            {COUNTRY_OPTIONS.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Idioma</label>
                          <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                          >
                            {LANGUAGE_OPTIONS.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Año de nacimiento</label>
                          <select
                            value={birthYear || ''}
                            onChange={(e) => setBirthYear(Number(e.target.value) || 0)}
                            className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                          >
                            <option value="">Selecciona…</option>
                            {birthYears.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5 space-y-4">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wide">Contraseña</h3>
                      <p className="text-xs text-gray-500">Opcional. Solo rellena si quieres cambiarla.</p>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Contraseña actual</label>
                          <input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                            autoComplete="current-password"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Nueva contraseña</label>
                            <input
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                              autoComplete="new-password"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Confirmar nueva</label>
                            <input
                              type="password"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white focus:border-blue-500 outline-none"
                              autoComplete="new-password"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={saveLoading}
                      className="w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all active:scale-[0.99]"
                    >
                      {saveLoading ? <Loader2 className="animate-spin" size={18} /> : null}
                      Guardar cambios
                    </button>
                  </>
                )}
              </form>
            )}

            {token && (
              <form
                onSubmit={(e) => void submitSuggestion(e)}
                className="bg-gray-950/40 border border-gray-800 rounded-2xl p-5 space-y-3"
              >
                <h3 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
                  <MessageSquare size={16} className="text-cyan-400" />
                  Buzón de sugerencias
                </h3>
                <p className="text-xs text-gray-500">
                  Ideas, mejoras o problemas. El equipo las revisa en el panel de administración.
                </p>
                <textarea
                  value={suggestionText}
                  onChange={(e) => setSuggestionText(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Cuéntanos qué te gustaría ver en Albedrío…"
                  className="w-full rounded-xl bg-gray-950 border border-gray-700 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none resize-y min-h-[96px]"
                />
                <div className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                  <span>{suggestionText.trim().length}/2000</span>
                  <span>Mínimo 10 caracteres</span>
                </div>
                {suggestionOk && (
                  <p className="text-sm text-emerald-300 border border-emerald-900/50 bg-emerald-950/30 rounded-lg px-3 py-2">
                    {suggestionOk}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={suggestionSending || suggestionText.trim().length < 10}
                  className="w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-45 text-white font-semibold py-2.5 px-4 rounded-xl border border-gray-700 transition-colors"
                >
                  {suggestionSending ? <Loader2 className="animate-spin" size={18} /> : <MessageSquare size={18} />}
                  Enviar sugerencia
                </button>
              </form>
            )}

            <button
              onClick={logout}
              className="w-full inline-flex items-center justify-center gap-2 bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-200 font-bold py-3 px-4 rounded-xl transition-all active:scale-95"
            >
              <LogOut size={18} /> Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
