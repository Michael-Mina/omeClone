import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Languages, Send } from 'lucide-react';
import { LANGUAGE_OPTIONS, languageLabel } from '../data/profileOptions';

/** Emojis de acceso rápido (entre los más usados en chat global). */
export const CHAT_QUICK_EMOJIS = ['😂', '❤️', '👍', '🔥', '😭'] as const;

export interface ChatLine {
  id: string;
  /** Texto mostrado (traducido al idioma elegido en el selector). */
  text: string;
  /** Texto original del socket, si la traducción difiere. */
  originalText?: string;
  mine: boolean;
  senderLabel?: string;
  ts: number;
}

type Props = {
  messages: ChatLine[];
  onSend?: (text: string) => void;
  disabled?: boolean;
  /** Solo lectura (p. ej. monitor admin): sin campo de envío */
  readOnly?: boolean;
  /** Texto vacío cuando readOnly */
  emptyReadOnlyHint?: string;
  /** Título junto a «Chat» */
  headerTitle?: string;
  /** Desktop: panel lateral más ancho; móvil: barra inferior compacta */
  variant?: 'desktop' | 'mobile';
  /** Ocultar panel (p. ej. monitor admin o móvil) */
  onHideChat?: () => void;
  /** Selector de idioma de traducción (mensajes entrantes) */
  translateMode?: string;
  onTranslateModeChange?: (mode: string) => void;
  profileLanguageCode?: string | null;
  /** Texto resumido del destino actual, p. ej. «Español» */
  translateTargetLabel?: string;
};

export function MatchChatPanel({
  messages,
  onSend,
  disabled = false,
  readOnly = false,
  emptyReadOnlyHint,
  headerTitle,
  variant = 'desktop',
  onHideChat,
  translateMode,
  onTranslateModeChange,
  profileLanguageCode,
  translateTargetLabel,
}: Props) {
  const translateSelectId = useId();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendText = (raw: string) => {
    if (readOnly) return;
    const t = raw.trim();
    if (!t || disabled) return;
    onSend?.(t);
    setDraft('');
  };

  const compact = variant === 'mobile';

  return (
    <div
      className={`flex flex-col min-h-0 w-full ${
        readOnly ? 'h-full max-h-full' : compact ? 'h-full max-h-[34vh]' : 'h-full'
      }`}
    >
      <div
        className={`shrink-0 border-b border-gray-800/80 ${compact ? 'px-2 py-1' : 'px-2 py-1.5'}`}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 shrink-0">
              {headerTitle ?? 'Chat'}
            </p>
            {translateMode !== undefined && onTranslateModeChange ? (
              <>
                <Languages
                  size={compact ? 12 : 13}
                  className="text-gray-500 shrink-0 opacity-90"
                  aria-hidden
                />
                <label htmlFor={translateSelectId} className="sr-only">
                  Idioma de traducción de mensajes
                </label>
                <select
                  id={translateSelectId}
                  value={translateMode}
                  onChange={(e) => onTranslateModeChange(e.target.value)}
                  title={
                    translateTargetLabel
                      ? `Traducción a ${translateTargetLabel}`
                      : 'Idioma de traducción'
                  }
                  className={`min-w-0 flex-1 max-w-[min(11rem,46vw)] rounded-md bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    compact ? 'text-[10px] py-0.5 px-1' : 'text-[11px] py-1 px-1.5'
                  }`}
                >
                  <option value="profile">
                    Según perfil (
                    {profileLanguageCode ? languageLabel(profileLanguageCode) : '→ EN'})
                  </option>
                  {LANGUAGE_OPTIONS.filter((o) => o.value).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </>
            ) : translateTargetLabel ? (
              <span
                className="text-[9px] text-gray-500 truncate normal-case tracking-normal min-w-0"
                title={`Traducción a ${translateTargetLabel}`}
              >
                → {translateTargetLabel}
              </span>
            ) : null}
          </div>
          {onHideChat && (
            <button
              type="button"
              onClick={onHideChat}
              className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-gray-400 hover:text-white py-0.5 px-1.5 rounded-md hover:bg-gray-800 transition-colors"
              title="Ocultar chat"
              aria-label="Ocultar chat"
            >
              Ocultar
              <ChevronDown size={14} className="opacity-80" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className={`flex-1 min-h-0 overflow-y-auto space-y-2 ${compact ? 'px-2 py-1' : 'px-2 py-2'}`}
      >
        {messages.length === 0 && (
          <p className={`text-gray-600 text-center px-2 ${compact ? 'text-[11px] py-3' : 'text-xs py-6'}`}>
            {readOnly
              ? emptyReadOnlyHint ?? 'Sin mensajes en esta sesión.'
              : disabled
                ? 'Conecta con alguien para chatear.'
                : 'Escribí un mensaje…'}
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[92%] rounded-2xl break-words shadow-sm ${
                compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2 text-sm'
              } ${
                m.mine
                  ? 'bg-blue-600/90 text-white rounded-br-md'
                  : 'bg-gray-800 text-gray-100 rounded-bl-md border border-gray-700/80'
              }`}
            >
              {!m.mine && (
                <p className="text-[10px] font-semibold text-gray-400 mb-0.5 truncate">{m.senderLabel ?? 'Otro'}</p>
              )}
              <p className="whitespace-pre-wrap leading-snug">{m.text}</p>
              {m.originalText && m.originalText !== m.text ? (
                <p
                  className={`mt-1.5 pt-1.5 border-t text-[10px] leading-snug opacity-85 ${
                    m.mine ? 'border-white/20 text-blue-100/90' : 'border-gray-600/80 text-gray-400'
                  }`}
                >
                  Original: <span className="opacity-95">{m.originalText}</span>
                </p>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!readOnly && (
        <div
          className={`shrink-0 border-t border-gray-800 bg-gray-950/95 ${
            compact ? 'p-1.5 space-y-1' : 'p-2 space-y-2'
          }`}
        >
          <div
            className={`flex flex-wrap ${compact ? 'gap-0.5 justify-center' : 'gap-1 justify-start'}`}
          >
            {CHAT_QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={disabled}
                onClick={() => sendText(emoji)}
                className={`leading-none rounded-md bg-gray-800/80 hover:bg-gray-700 disabled:opacity-35 disabled:pointer-events-none transition-colors border border-gray-700/60 ${
                  compact ? 'text-base px-1.5 py-0.5' : 'text-xl px-2 py-1.5 rounded-lg'
                }`}
                title={`Enviar ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className={`flex gap-1.5 ${compact ? 'items-center' : 'items-end'}`}>
            <textarea
              rows={compact ? 1 : 2}
              maxLength={2000}
              placeholder={disabled ? '…' : 'Mensaje'}
              disabled={disabled}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendText(draft);
                }
              }}
              className={`flex-1 min-w-0 resize-none rounded-lg bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40 ${
                compact
                  ? 'text-[13px] leading-snug px-2.5 py-1.5 min-h-[36px] max-h-[72px] placeholder:text-[13px]'
                  : 'text-sm px-3 py-2 rounded-xl'
              }`}
            />
            <button
              type="button"
              disabled={disabled || !draft.trim()}
              onClick={() => sendText(draft)}
              className={`shrink-0 rounded-lg flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:opacity-35 disabled:pointer-events-none text-white shadow-md ${
                compact ? 'h-9 w-9' : 'h-10 w-10 rounded-xl'
              }`}
              title="Enviar"
              aria-label="Enviar mensaje"
            >
              <Send size={compact ? 16 : 18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
