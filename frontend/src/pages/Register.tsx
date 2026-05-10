import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Video } from 'lucide-react';
import {
  GENDER_OPTIONS,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  getBirthYearsDescending,
  MIN_AGE,
} from '../data/profileOptions';
import { apiUrl } from '../config/apiBase';
import { OAuthLoginButtons, type OAuthTokenPayload } from '../components/OAuthLoginButtons';
import { useAppStore } from '../store/useAppStore';

export default function Register() {
  const { setAuth } = useAppStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [birthYear, setBirthYear] = useState<number>(0);
  const [gender, setGender] = useState('');
  const [country, setCountry] = useState('');
  const [language, setLanguage] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const birthYears = getBirthYearsDescending();

  const handleOAuthSuccess = (data: OAuthTokenPayload) => {
    const role = data.is_superuser ? 'superadmin' : 'user';
    setAuth(String(data.user_id || 'user'), data.access_token, role, data.display_name || null, false, {
      exemptFromAiCensorship: Boolean(data.exempt_from_ai_censorship),
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ageConfirmed) {
      alert(`Debes confirmar que tienes ${MIN_AGE} años o más para registrarte.`);
      return;
    }
    if (!birthYear || !gender || !country || !language) {
      alert('Completa año de nacimiento, género, país e idioma.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
          birth_year: birthYear,
          gender,
          country,
          language,
          is_anonymous: false,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        alert('Registro exitoso, por favor inicia sesión');
        navigate('/login');
      } else {
        alert(typeof data.detail === 'string' ? data.detail : 'Error al registrarse');
      }
    } catch {
      alert('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-blue-900/30 rounded-full blur-3xl"></div>

      <div className="max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-3xl shadow-2xl p-8 z-10">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30 transform rotate-6">
            <Video size={32} className="text-white transform -rotate-6" />
          </div>
          <h2 className="text-3xl font-bold text-white text-center">Crea tu Cuenta</h2>
          <p className="text-gray-400 mt-2 text-center text-sm">Empieza a conocer personas increíbles.</p>
        </div>

        <OAuthLoginButtons onSuccess={handleOAuthSuccess} disabled={loading} />

        <div className="mt-5 mb-2 flex items-center justify-center space-x-4">
          <div className="h-px bg-gray-800 flex-1"></div>
          <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">O con correo</span>
          <div className="h-px bg-gray-800 flex-1"></div>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Nombre de Usuario
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder-gray-600"
              placeholder="Ej. CoolGamer99"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder-gray-600"
              placeholder="tu@correo.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder-gray-600"
              placeholder="••••••••"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Año de nacimiento
            </label>
            <select
              value={birthYear || ''}
              onChange={(e) => setBirthYear(Number(e.target.value) || 0)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            >
              <option value="">Selecciona…</option>
              {birthYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1.5">El registro está limitado a mayores de {MIN_AGE} años.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Género</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value || 'ph'} value={o.value}>
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
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Idioma</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              className="mt-1 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 shrink-0"
            />
            <span className="text-sm text-gray-300 leading-snug group-hover:text-white transition-colors">
              Confirmo que tengo <strong className="text-white">{MIN_AGE} años cumplidos o más</strong> y que los datos son
              veraces.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 mt-2"
          >
            {loading ? 'Registrando...' : 'Crear mi cuenta'}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-gray-400">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
