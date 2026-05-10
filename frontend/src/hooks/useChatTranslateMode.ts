import { useCallback, useEffect, useState } from 'react';
import { LANGUAGE_OPTIONS } from '../data/profileOptions';

const STORAGE_KEY = 'ometv-chat-translate-mode';

function validModes(): Set<string> {
  const s = new Set<string>(['profile']);
  for (const o of LANGUAGE_OPTIONS) {
    if (o.value) s.add(o.value);
  }
  return s;
}

const VALID = validModes();

function readStored(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (!v) return 'profile';
    return VALID.has(v) ? v : 'profile';
  } catch {
    return 'profile';
  }
}

/** Idioma destino para traducir mensajes del chat (persistido en localStorage). */
export function useChatTranslateMode() {
  const [mode, setModeState] = useState<string>(() =>
    typeof window !== 'undefined' ? readStored() : 'profile'
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* private mode */
    }
  }, [mode]);

  const setMode = useCallback((next: string) => {
    setModeState(VALID.has(next) ? next : 'profile');
  }, []);

  return { mode, setMode };
}
