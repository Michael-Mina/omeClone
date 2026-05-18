import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';

export type SpeedDialAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
  active?: boolean;
  tone?: 'default' | 'danger' | 'violet' | 'emerald' | 'blue';
};

type Props = {
  actions: SpeedDialAction[];
  className?: string;
};

function actionToneClass(tone: SpeedDialAction['tone'], active?: boolean): string {
  if (tone === 'danger') {
    return active
      ? 'bg-red-900/95 border-red-500 text-red-100'
      : 'bg-gray-900/95 border-gray-700 text-red-300 hover:border-red-500/60 hover:bg-red-950/90';
  }
  if (tone === 'violet') {
    return active
      ? 'bg-violet-700/95 border-violet-500 text-white'
      : 'bg-gray-900/95 border-gray-700 text-violet-200 hover:border-violet-500/50 hover:bg-gray-800';
  }
  if (tone === 'emerald') {
    return active
      ? 'bg-emerald-800/95 border-emerald-500 text-white'
      : 'bg-gray-900/95 border-gray-700 text-gray-100 hover:border-emerald-500/50 hover:bg-gray-800';
  }
  if (tone === 'blue') {
    return 'bg-gradient-to-br from-blue-600 to-indigo-700 border-blue-500/40 text-white hover:brightness-110';
  }
  return 'bg-gray-900/95 border-gray-700 text-gray-100 hover:border-gray-500 hover:bg-gray-800';
}

export function MatchSpeedDial({ actions, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const visible = actions.filter((a) => !a.hidden);

  const isOpen = open;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (visible.length === 0) return null;

  return (
    <>
      {isOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[24] cursor-default bg-black/25 backdrop-blur-[1px]"
          aria-label="Cerrar menú de acciones"
          onClick={close}
        />
      )}

      <div className={`flex flex-col items-end gap-2 ${className}`}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={menuId}
          aria-haspopup="true"
          onClick={() => setOpen((v) => !v)}
          className={`relative z-[26] h-11 w-11 shrink-0 rounded-full flex items-center justify-center shadow-xl border ring-1 ring-white/10 transition-all duration-200 active:scale-95 ${
            isOpen
              ? 'bg-gradient-to-br from-blue-600 to-indigo-700 border-blue-400/50 text-white rotate-0'
              : 'bg-gradient-to-br from-blue-600 to-indigo-700 border-blue-400/50 text-white hover:brightness-110 hover:scale-105'
          }`}
          title={isOpen ? 'Cerrar acciones' : 'Acciones'}
        >
          <span
            className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : 'rotate-0'}`}
            aria-hidden
          >
            {isOpen ? <X size={22} strokeWidth={2.5} /> : <Plus size={22} strokeWidth={2.5} />}
          </span>
        </button>

        <div
          id={menuId}
          role="menu"
          aria-label="Acciones de videollamada"
          className={`relative z-[26] flex flex-col items-end gap-2 origin-top transition-all duration-200 ${
            isOpen
              ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto max-h-[min(70vh,420px)]'
              : 'opacity-0 scale-95 -translate-y-1 pointer-events-none max-h-0 overflow-hidden'
          }`}
        >
          {visible.map((action, index) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                if (action.disabled) return;
                action.onClick();
                close();
              }}
              className={`group flex items-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none ${
                isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
              }`}
              style={{ transitionDelay: isOpen ? `${index * 40}ms` : '0ms' }}
              title={action.label}
              aria-label={action.label}
              aria-pressed={action.active}
            >
              <span className="pointer-events-none max-w-[9rem] px-2 py-1 rounded-lg bg-black/75 border border-white/10 text-[10px] font-semibold text-gray-100 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity hidden sm:block">
                {action.label}
              </span>
              <span
                className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center border shadow-lg active:scale-95 transition-transform ${actionToneClass(
                  action.tone,
                  action.active
                )}`}
              >
                {action.icon}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
