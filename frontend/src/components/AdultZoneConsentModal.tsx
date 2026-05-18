import { useEffect, useId, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { countryLabel } from '../data/profileOptions';

type Props = {
  open: boolean;
  minAge: number;
  salaLabel: string;
  countryCode: string | null | undefined;
  onClose: () => void;
  onConfirm: () => void;
};

export function AdultZoneConsentModal({
  open,
  minAge,
  salaLabel,
  countryCode,
  onClose,
  onConfirm,
}: Props) {
  const [accepted, setAccepted] = useState(false);
  const checkboxId = useId();
  const countryName = countryLabel(countryCode);
  const countryPhrase =
    countryName !== '—' ? ` en ${countryName}` : ' en mi país de residencia';

  useEffect(() => {
    if (open) setAccepted(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adult-consent-title"
    >
      <div className="relative w-full max-w-lg max-h-[min(90dvh,640px)] flex flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-5 md:p-6 border-b border-gray-800 shrink-0">
          <div className="p-2 rounded-xl bg-rose-950/80 text-rose-400 shrink-0">
            <AlertTriangle size={24} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <h2 id="adult-consent-title" className="text-lg md:text-xl font-bold text-white leading-snug">
              Aviso legal — {salaLabel}
            </h2>
            <p className="text-xs text-gray-400 mt-1">Lee y acepta antes de continuar</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 md:px-6 py-4 space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            Estás a punto de entrar en una zona destinada exclusivamente a personas que han alcanzado la
            <strong className="text-white"> mayoría de edad{countryPhrase}</strong> (al menos{' '}
            <strong className="text-white">{minAge} años</strong> según la normativa aplicable en tu
            jurisdicción).
          </p>
          <p>
            En esta sala de Albedrío <strong className="text-white">no se aplica censura automática por IA</strong>{' '}
            y es posible que veas o transmitas contenido con <strong className="text-white">desnudez</strong> u otro
            material para adultos procedente de otros usuarios en tiempo real.
          </p>
          <p>
            Al continuar, declaras bajo tu responsabilidad que cumples el requisito de edad, que accedes por
            voluntad propia y que estás informado del tipo de contenido que puede aparecer.
          </p>
          <p className="text-gray-400 text-xs border-l-2 border-rose-500/60 pl-3">
            Eximes a Albedrío, sus operadores, desarrolladores, colaboradores y afiliados de cualquier
            responsabilidad legal derivada del material que visualices, compartas o generes en esta sala,
            incluidas reclamaciones por contenido ofensivo, daños o incumplimiento de leyes locales. El uso de
            esta sección es bajo tu único riesgo.
          </p>
        </div>

        <div className="p-5 md:p-6 border-t border-gray-800 bg-gray-950/90 shrink-0 space-y-4">
          <label
            htmlFor={checkboxId}
            className="flex items-start gap-3 cursor-pointer select-none group"
          >
            <input
              id={checkboxId}
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-800 text-rose-500 focus:ring-rose-500 focus:ring-offset-gray-900"
            />
            <span className="text-sm text-gray-200 leading-snug group-hover:text-white transition-colors">
              Confirmo que tengo al menos {minAge} años{countryPhrase}, que entiendo que podré ver contenido con
              desnudez y que acepto el aviso legal anterior.
            </span>
          </label>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-300 border border-gray-700 hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!accepted}
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg transition-all"
            >
              Ingresar a {salaLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
