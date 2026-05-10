import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { Video, X } from 'lucide-react';
import {
  GENDER_OPTIONS,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  getBirthYearsDescending,
} from '../data/profileOptions';
import { apiUrl } from '../config/apiBase';
import { OAuthLoginButtons, type OAuthTokenPayload } from '../components/OAuthLoginButtons';

export default function Login() {
  const { setAuth } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [showAnonymousSetup, setShowAnonymousSetup] = useState(false);
  const [anonBirthYear, setAnonBirthYear] = useState<number>(0);
  const [anonGender, setAnonGender] = useState('');
  const [anonCountry, setAnonCountry] = useState('');
  const [anonLanguage, setAnonLanguage] = useState('');
  const [anonAdultConfirmed, setAnonAdultConfirmed] = useState(false);

  const birthYears = getBirthYearsDescending();

  const resetAnonymousForm = () => {
    setAnonBirthYear(0);
    setAnonGender('');
    setAnonCountry('');
    setAnonLanguage('');
    setAnonAdultConfirmed(false);
  };

  const handleOAuthSuccess = (data: OAuthTokenPayload) => {
    const role = data.is_superuser ? 'superadmin' : 'user';
    setAuth(String(data.user_id || 'user'), data.access_token, role, data.display_name || null, false, {
      exemptFromAiCensorship: Boolean(data.exempt_from_ai_censorship),
    });
  };

  const openAnonymousWizard = () => {
    resetAnonymousForm();
    setShowAnonymousSetup(true);
  };

  const handleAnonymousConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!anonAdultConfirmed) {
      alert('Debes confirmar que tienes 18 años o más para continuar.');
      return;
    }
    if (!anonBirthYear) {
      alert('Selecciona tu año de nacimiento.');
      return;
    }
    if (!anonGender || !anonCountry || !anonLanguage) {
      alert('Completa género, país e idioma.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/anonymous-login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          birth_year: anonBirthYear,
          gender: anonGender,
          country: anonCountry,
          language: anonLanguage,
          adult_declaration: true,
        }),
      });
      const data = await response.json();
      if (response.ok) {
        setShowAnonymousSetup(false);
        setAuth(
          String(data.user_id || `anon_${Math.floor(Math.random() * 10000)}`),
          data.access_token,
          'user',
          data.display_name || null,
          true,
          {
            gender: anonGender,
            country: anonCountry,
            language: anonLanguage,
            birthYear: anonBirthYear,
            exemptFromAiCensorship: Boolean(data.exempt_from_ai_censorship),
          }
        );
      } else {
        alert(typeof data.detail === 'string' ? data.detail : 'No se pudo entrar como anónimo.');
      }
    } catch {
      alert('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-900/30 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-900/30 rounded-full blur-3xl"></div>

      <div className="max-w-md w-full bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-3xl shadow-2xl p-8 z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30 transform -rotate-6">
            <Video size={32} className="text-white transform rotate-6" />
          </div>
          <h2 className="text-3xl font-bold text-white text-center">Inicia Sesión</h2>
          <p className="text-gray-400 mt-2 text-center text-sm">
            Usa tu cuenta de Google o entra como invitado anónimo.
          </p>
        </div>

        <OAuthLoginButtons onSuccess={handleOAuthSuccess} disabled={loading} />

        <div className="mt-6 flex items-center justify-center space-x-4">
          <div className="h-px bg-gray-800 flex-1"></div>
          <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">O sin cuenta</span>
          <div className="h-px bg-gray-800 flex-1"></div>
        </div>

        <button
          type="button"
          onClick={openAnonymousWizard}
          disabled={loading}
          className="mt-6 w-full bg-gray-800/80 hover:bg-gray-700 text-white font-medium py-3.5 px-4 rounded-xl border border-gray-700 transition-all shadow-md flex items-center justify-center gap-2"
        >
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Entrar como Anónimo
        </button>
      </div>

      {showAnonymousSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="relative max-w-lg w-full bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 md:p-8">
            <button
              type="button"
              onClick={() => setShowAnonymousSetup(false)}
              className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
            <h3 className="text-xl font-bold text-white pr-10">Antes de continuar</h3>
            <p className="text-sm text-gray-400 mt-1 mb-5">
              OmeClone es solo para mayores de 18 años. Indica tus datos para personalizar tu experiencia.
            </p>
            <form onSubmit={handleAnonymousConfirm} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Año de nacimiento
                </label>
                <select
                  value={anonBirthYear || ''}
                  onChange={(e) => setAnonBirthYear(Number(e.target.value) || 0)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                  value={anonGender}
                  onChange={(e) => setAnonGender(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                  value={anonCountry}
                  onChange={(e) => setAnonCountry(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                  value={anonLanguage}
                  onChange={(e) => setAnonLanguage(e.target.value)}
                  className="w-full bg-gray-950/50 border border-gray-800 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
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
                  checked={anonAdultConfirmed}
                  onChange={(e) => setAnonAdultConfirmed(e.target.checked)}
                  className="mt-1 rounded border-gray-600 text-green-600 focus:ring-green-500 shrink-0"
                />
                <span className="text-sm text-gray-300 leading-snug group-hover:text-white transition-colors">
                  Confirmo que tengo <strong className="text-white">18 años cumplidos o más</strong> y soy responsable del
                  uso de esta plataforma. Entiendo que el acceso puede ser denegado si no es así.
                </span>
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-3.5 rounded-xl disabled:opacity-50"
              >
                {loading ? 'Entrando...' : 'Continuar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
