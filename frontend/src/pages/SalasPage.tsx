import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, ShieldCheck, User, Video, ArrowRight } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { socket } from '../sockets/socket';
import type { MatchZone } from '../types/matchZone';
import { MATCH_ZONE_META, getAdultZoneDisplay, userMeetsAdultZone } from '../types/matchZone';
import { adultZoneBlockedHint, getLegalAdultAge } from '../data/legalAdultAge';
import { AdultZoneConsentModal } from '../components/AdultZoneConsentModal';

const ZONES: MatchZone[] = ['moderated', 'adult'];

export default function SalasPage() {
  const navigate = useNavigate();
  const {
    matchZone,
    setMatchZone,
    setSalaSessionActive,
    stopMatch,
    displayName,
    isAnonymous,
    birthYear,
    country,
  } = useAppStore();

  const [picked, setPicked] = useState<MatchZone>(matchZone);
  const [consentOpen, setConsentOpen] = useState(false);
  const adultDisplay = getAdultZoneDisplay(country);
  const canAdult = userMeetsAdultZone(birthYear, country);
  const minAdultAge = getLegalAdultAge(country);

  useEffect(() => {
    setSalaSessionActive(false);
    socket.emit('cancel_matchmaking', {});
    stopMatch();
  }, [setSalaSessionActive, stopMatch]);

  useEffect(() => {
    if (picked === 'adult' && !canAdult) {
      setPicked('moderated');
    }
  }, [picked, canAdult]);

  const proceedToVideo = () => {
    setMatchZone(picked);
    setSalaSessionActive(true);
    setConsentOpen(false);
    navigate('/app', { replace: true });
  };

  const enterSala = () => {
    if (picked === 'adult' && !canAdult) return;
    if (picked === 'adult') {
      setConsentOpen(true);
      return;
    }
    proceedToVideo();
  };

  return (
    <div className="min-h-[100dvh] bg-gray-950 text-white font-sans relative overflow-hidden flex flex-col">
      <div className="absolute top-[-12%] left-[-8%] w-[28rem] h-[28rem] bg-blue-900/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-12%] right-[-8%] w-[28rem] h-[28rem] bg-purple-900/25 rounded-full blur-3xl pointer-events-none" />

      <header className="relative z-10 p-4 md:p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Albedrío
          </h1>
          <p className="text-sm text-gray-400 mt-1">Elige una sala antes de conectar</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="px-3 py-2 text-xs font-semibold rounded-xl flex items-center gap-2 bg-gray-800/90 border border-gray-700 hover:bg-gray-700 transition-colors"
        >
          <User size={16} />
          <span className="max-w-[120px] truncate hidden sm:inline">
            {displayName || (isAnonymous ? 'Anónimo' : 'Perfil')}
          </span>
        </button>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-8 md:pb-12 max-w-5xl mx-auto w-full">
        <p className="text-center text-gray-300 text-base md:text-lg mb-8 max-w-xl leading-relaxed">
          Solo te emparejaremos con personas que estén en la{' '}
          <span className="text-white font-semibold">misma sala</span> que elijas.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 w-full">
          {ZONES.map((zone) => {
            const meta = zone === 'adult' ? adultDisplay : MATCH_ZONE_META[zone];
            const selected = picked === zone;
            const disabled = zone === 'adult' && !canAdult;
            const Icon = zone === 'moderated' ? ShieldCheck : Flame;

            return (
              <button
                key={zone}
                type="button"
                disabled={disabled}
                onClick={() => setPicked(zone)}
                className={`group relative text-left rounded-3xl border-2 p-6 md:p-8 transition-all duration-200 min-h-[220px] md:min-h-[260px] flex flex-col ${
                  selected
                    ? `border-transparent bg-gradient-to-br ${meta.accent} shadow-2xl shadow-black/40 scale-[1.02] ring-2 ring-white/25`
                    : 'border-gray-800 bg-gray-900/70 hover:border-gray-600 hover:bg-gray-900/90'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`absolute top-4 right-4 text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${
                    selected ? 'bg-black/30 text-white' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {meta.badge}
                </span>

                <Icon
                  size={40}
                  className={`mb-4 ${selected ? 'text-white' : zone === 'adult' ? 'text-orange-400' : 'text-blue-400'}`}
                  strokeWidth={1.75}
                />

                <h2 className={`text-xl md:text-2xl font-bold mb-2 ${selected ? 'text-white' : 'text-gray-100'}`}>
                  {meta.label}
                </h2>
                <p className={`text-sm md:text-base leading-relaxed flex-1 ${selected ? 'text-white/90' : 'text-gray-400'}`}>
                  {meta.subtitle}
                </p>

                {zone === 'moderated' && (
                  <ul className={`mt-4 space-y-1.5 text-xs md:text-sm ${selected ? 'text-white/80' : 'text-gray-500'}`}>
                    <li>• Detección de contenido por IA</li>
                    <li>• Avisos y bloqueos automáticos</li>
                  </ul>
                )}
                {zone === 'adult' && (
                  <ul className={`mt-4 space-y-1.5 text-xs md:text-sm ${selected ? 'text-white/80' : 'text-gray-500'}`}>
                    <li>• Sin censura por IA</li>
                    <li>• Sin sanciones automáticas</li>
                  </ul>
                )}

                {selected && (
                  <span className="mt-5 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-white/90">
                    Seleccionada <ArrowRight size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!canAdult && (
          <p className="mt-4 text-sm text-amber-400/90 text-center max-w-md">
            {adultZoneBlockedHint(country)}
          </p>
        )}

        <button
          type="button"
          onClick={enterSala}
          disabled={picked === 'adult' && !canAdult}
          className="mt-8 md:mt-10 w-full max-w-md py-4 px-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-green-900/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Video size={22} />
          Entrar a {picked === 'adult' ? adultDisplay.label : MATCH_ZONE_META[picked].label}
        </button>
      </main>

      <AdultZoneConsentModal
        open={consentOpen}
        minAge={minAdultAge}
        salaLabel={adultDisplay.label}
        countryCode={country}
        onClose={() => setConsentOpen(false)}
        onConfirm={proceedToVideo}
      />
    </div>
  );
}
