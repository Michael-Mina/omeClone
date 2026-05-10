import { apiUrl } from '../config/apiBase';

/** Entradas máximas en caché (FIFO simple al superar el límite). */
const MAX_CACHE_ENTRIES = 400;
const translationCache = new Map<string, string>();

function cacheKey(targetLang: string, raw: string): string {
  return `${targetLang}\u0001${raw}`;
}

function cacheGet(targetLang: string, raw: string): string | undefined {
  return translationCache.get(cacheKey(targetLang, raw));
}

function cacheSet(targetLang: string, raw: string, translated: string): void {
  const key = cacheKey(targetLang, raw);
  if (translationCache.size >= MAX_CACHE_ENTRIES && !translationCache.has(key)) {
    const oldest = translationCache.keys().next().value;
    if (oldest !== undefined) translationCache.delete(oldest);
  }
  translationCache.set(key, translated);
}

/** Si no parece haber letras, no llamamos al API (ahorra tiempo y cuotas). */
export function chatLineLikelyNeedsTranslation(text: string): boolean {
  return /[\p{L}]/u.test(text.trim());
}

/**
 * Preferencia del usuario: `profile` → idioma de cuenta; si no, código (`es`, `en`, …).
 */
export function resolveTranslateTargetLang(
  mode: string | null | undefined,
  profileLang: string | null | undefined
): string {
  const m = mode ?? 'profile';
  if (m === 'profile' || m === '') {
    if (!profileLang || profileLang === '') return 'en';
    return profileLang === 'OTHER' ? 'en' : profileLang;
  }
  return m === 'OTHER' ? 'en' : m;
}

function normalizeTargetLang(targetLang: string | null | undefined): string {
  return targetLang && targetLang !== '' ? targetLang : 'en';
}

export async function translateChatText(
  text: string,
  targetLang: string | null | undefined,
  token: string | null
): Promise<string> {
  if (!token?.trim()) return text;
  const raw = text.trim();
  if (!raw) return text;

  const tgt = normalizeTargetLang(targetLang);
  const cached = cacheGet(tgt, raw);
  if (cached !== undefined) return cached;

  const res = await fetch(apiUrl('/api/translate'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: raw,
      target_lang: tgt,
    }),
  });

  if (!res.ok) return text;
  const data = (await res.json()) as { text?: string };
  const out = typeof data.text === 'string' ? data.text : text;
  cacheSet(tgt, raw, out);
  return out;
}

/**
 * Devuelve texto listo para mostrar y, si la traducción difiere, el original.
 * Usa caché + misma heurística que el chat principal.
 */
export async function translateForChatDisplay(
  raw: string,
  targetLang: string | null | undefined,
  token: string | null
): Promise<{ text: string; originalText?: string }> {
  if (!token?.trim()) return { text: raw };
  if (!chatLineLikelyNeedsTranslation(raw)) return { text: raw };
  try {
    const translated = await translateChatText(raw, targetLang, token);
    if (translated !== raw) return { text: translated, originalText: raw };
    return { text: raw };
  } catch {
    return { text: raw };
  }
}
