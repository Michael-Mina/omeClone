import type { MatchZone } from '../types/matchZone';
import { MATCH_ZONE_META } from '../types/matchZone';
import { ShieldCheck, Flame } from 'lucide-react';

type Props = {
  value: MatchZone;
  onChange: (zone: MatchZone) => void;
  adultDisabled?: boolean;
  adultDisabledHint?: string;
  compact?: boolean;
};

export function MatchZonePicker({
  value,
  onChange,
  adultDisabled = false,
  adultDisabledHint,
  compact = false,
}: Props) {
  const zones: MatchZone[] = ['moderated', 'adult'];

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <p className={`text-gray-400 ${compact ? 'text-xs text-center' : 'text-sm text-center'}`}>
        Elige en qué sala quieres conectar
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
        {zones.map((zone) => {
          const meta = MATCH_ZONE_META[zone];
          const selected = value === zone;
          const disabled = zone === 'adult' && adultDisabled;
          return (
            <button
              key={zone}
              type="button"
              disabled={disabled}
              onClick={() => onChange(zone)}
              className={`relative text-left rounded-xl border p-3 sm:p-4 transition-all ${
                selected
                  ? `border-transparent bg-gradient-to-br ${meta.accent} text-white shadow-lg ring-2 ring-white/20`
                  : 'border-gray-700 bg-gray-800/80 text-gray-200 hover:border-gray-600 hover:bg-gray-800'
              } ${disabled ? 'opacity-45 cursor-not-allowed hover:border-gray-700 hover:bg-gray-800/80' : ''}`}
            >
              <div className="flex items-start gap-2 pr-10">
                {zone === 'moderated' ? (
                  <ShieldCheck size={compact ? 18 : 20} className="shrink-0 mt-0.5" />
                ) : (
                  <Flame size={compact ? 18 : 20} className="shrink-0 mt-0.5" />
                )}
                <div>
                  <span className={`font-bold block ${compact ? 'text-sm' : 'text-base'}`}>
                    {meta.label}
                  </span>
                  <span
                    className={`block mt-1 leading-snug ${compact ? 'text-[10px]' : 'text-xs'} ${
                      selected ? 'text-white/85' : 'text-gray-400'
                    }`}
                  >
                    {meta.subtitle}
                  </span>
                </div>
              </div>
              <span
                className={`absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  selected ? 'bg-black/25' : 'bg-gray-900 text-gray-400'
                }`}
              >
                {meta.badge}
              </span>
            </button>
          );
        })}
      </div>
      {adultDisabled && adultDisabledHint ? (
        <p className="text-xs text-amber-400/90 text-center leading-snug">{adultDisabledHint}</p>
      ) : null}
    </div>
  );
}
