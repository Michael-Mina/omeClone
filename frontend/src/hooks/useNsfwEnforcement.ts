import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../config/apiBase';
import { useAppStore } from '../store/useAppStore';

/** NSFW continuo ≥ esto → se reporta strike al servidor. */
export const NSFW_STREAK_MS = 10_000;
/** Debe coincidir con NSFW_COOLDOWN_MINUTES en el API (2 min). */
export const NSFW_COOLDOWN_MS = 2 * 60 * 1000;
/** Debe coincidir con NSFW_STRIKES_PERMANENT en el backend. */
export const NSFW_STRIKES_FOR_PERMANENT = 10;

/** Si `isNSFW` oscila, no reiniciar la racha hasta llevar ~esto en “limpio” (ms). */
const GRACE_FALSE_MS = 2800;

/** Tolerancia de reloj al acotar el cooldown al máximo de política (2 min). */
const COOLDOWN_CLOCK_SLACK_MS = 5000;

/**
 * ISO desde FastAPI/Pydantic / SQLite: con `+00:00` o `Z`; a veces naive UTC sin sufijo.
 * Sin zona explícita → UTC (`Z`), no hora local (evita que el bloqueo “expire” al recargar).
 */
function banUntilToTimestampMs(iso: string | number | null | undefined): number | null {
  if (iso == null || iso === '') return null;
  if (typeof iso === 'number' && Number.isFinite(iso)) {
    const ms = iso > 1e12 ? iso : iso * 1000;
    return Number.isFinite(ms) ? ms : null;
  }
  let s = String(iso).trim();
  if (!s.includes('T') && s.includes(' ')) {
    s = s.replace(' ', 'T');
  }

  const hasExplicitTz = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s);

  if (!hasExplicitTz) {
    const base = s.replace(/\.\d+$/, '');
    const ms = Date.parse(`${base}Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  let ms = Date.parse(s);
  if (Number.isFinite(ms)) return ms;
  const noFrac = s.replace(/\.\d+/, '');
  ms = Date.parse(noFrac);
  return Number.isFinite(ms) ? ms : null;
}

/** Nunca mostrar más de 2 min (+ slack): corrige fechas mal interpretadas o datos viejos. */
function clampBanEndMs(parsedMs: number | null): number | null {
  if (parsedMs == null || parsedMs <= Date.now()) return null;
  const cap = Date.now() + NSFW_COOLDOWN_MS + COOLDOWN_CLOCK_SLACK_MS;
  return Math.min(parsedMs, cap);
}

type NsfwPayload = {
  nsfw_strike_count?: number;
  nsfw_ban_until?: string | null;
  nsfw_permanent_ban?: boolean;
  is_banned?: boolean;
};

export function formatNsfwCountdown(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export type NsfwOverlayKind = 'none' | 'live' | 'cooldown' | 'permanent';

/**
 * Strike y cooldown vienen del servidor (POST /api/auth/nsfw-strike, GET /api/auth/me).
 */
/** Overrides desde intensidad NSFW global; null usa constantes legacy. */
export type NsfwEnforcementRuntime = {
  streakMs: number;
  graceFalseMs: number;
};

export function useNsfwEnforcement(
  isNSFW: boolean,
  exempt: boolean,
  userId: string | null,
  token: string | null,
  runtime: NsfwEnforcementRuntime | null = null
) {
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);
  const [strikeCount, setStrikeCount] = useState(0);
  const [permanent, setPermanent] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  /** Inicio de la ventana continua de NSFW (solo se anula tras GRACE_FALSE_MS sin contenido). */
  const streakMs = runtime?.streakMs ?? NSFW_STREAK_MS;
  const graceFalseMs = runtime?.graceFalseMs ?? GRACE_FALSE_MS;

  const streakAnchorRef = useRef<number | null>(null);
  const falseMsAccumRef = useRef(0);
  const lastTickRef = useRef<number>(Date.now());
  const cooldownEndRef = useRef<number | null>(null);
  const permanentRef = useRef(false);
  const reportingRef = useRef(false);

  useEffect(() => {
    cooldownEndRef.current = cooldownEnd;
  }, [cooldownEnd]);
  useEffect(() => {
    permanentRef.current = permanent;
  }, [permanent]);

  const applyServerPayload = useCallback((data: NsfwPayload) => {
    setStrikeCount(Math.max(0, Number(data.nsfw_strike_count) || 0));
    const banIso = data.nsfw_ban_until;
    const banMs = clampBanEndMs(banUntilToTimestampMs(banIso ?? null));
    const active =
      banMs != null && banMs > Date.now() ? banMs : null;
    cooldownEndRef.current = active;
    setCooldownEnd(active);
    const perm = !!(data.nsfw_permanent_ban || data.is_banned);
    permanentRef.current = perm;
    setPermanent(perm);
  }, []);

  /** Sincroniza estado NSFW con el servidor (otro dispositivo / F5). Solo hace falta el token. */
  useEffect(() => {
    if (exempt || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 403) {
          useAppStore.getState().setAuth('', '', 'user', null, false);
          return;
        }
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as NsfwPayload;
        if (!cancelled) applyServerPayload(data);
      } catch {
        /* red */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exempt, token, applyServerPayload]);

  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = userId;

    const clearLocal = () => {
      setStrikeCount(0);
      setCooldownEnd(null);
      cooldownEndRef.current = null;
      setPermanent(false);
      permanentRef.current = false;
      streakAnchorRef.current = null;
      falseMsAccumRef.current = 0;
      lastTickRef.current = Date.now();
    };

    if (userId == null || userId === '') {
      clearLocal();
      return;
    }
    if (prev !== null && prev !== '' && prev !== userId) {
      clearLocal();
    }
  }, [userId]);

  const reportStrikeToServer = useCallback(async () => {
    if (!token || reportingRef.current) return;
    reportingRef.current = true;
    try {
      const zone = useAppStore.getState().matchZone;
      const res = await fetch(apiUrl('/api/auth/nsfw-strike'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ match_zone: zone }),
      });
      const data = (await res.json()) as NsfwPayload & { detail?: unknown };
      if (res.status === 403) {
        applyServerPayload({ nsfw_permanent_ban: true, is_banned: true });
        useAppStore.getState().setAuth('', '', 'user', null, false);
        return;
      }
      if (res.ok) {
        applyServerPayload(data);
        if (cooldownEndRef.current == null) {
          const fb = Date.now() + NSFW_COOLDOWN_MS;
          cooldownEndRef.current = fb;
          setCooldownEnd(fb);
        }
      }
    } catch {
      /* sin fallback local: el servidor es la fuente de verdad */
    } finally {
      reportingRef.current = false;
    }
  }, [token, applyServerPayload]);

  useEffect(() => {
    if (exempt || permanentRef.current || !userId || !token) return;

    const tick = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.min(Math.max(now - lastTickRef.current, 0), 1500);
      lastTickRef.current = now;

      if (permanentRef.current) return;

      const cd = cooldownEndRef.current;
      if (cd !== null && now < cd) {
        streakAnchorRef.current = null;
        falseMsAccumRef.current = 0;
        return;
      }

      if (isNSFW) {
        falseMsAccumRef.current = 0;
        if (streakAnchorRef.current === null) streakAnchorRef.current = now;
        else if (now - streakAnchorRef.current >= streakMs) {
          streakAnchorRef.current = null;
          void reportStrikeToServer();
        }
      } else {
        falseMsAccumRef.current += dt;
        if (falseMsAccumRef.current >= graceFalseMs) {
          streakAnchorRef.current = null;
          falseMsAccumRef.current = 0;
        }
      }
    }, 250);

    return () => window.clearInterval(tick);
  }, [isNSFW, exempt, userId, token, reportStrikeToServer, streakMs, graceFalseMs]);

  useEffect(() => {
    const cd = cooldownEnd;
    if (!cd || Date.now() >= cd) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownEnd]);

  useEffect(() => {
    if (!cooldownEnd) return;
    if (Date.now() >= cooldownEnd) {
      cooldownEndRef.current = null;
      setCooldownEnd(null);
    }
  }, [cooldownEnd, nowTs]);

  const inCooldown = !!(cooldownEnd && Date.now() < cooldownEnd);
  const cooldownRemainingSec = useMemo(() => {
    if (!cooldownEnd || Date.now() >= cooldownEnd) return 0;
    return Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
  }, [cooldownEnd, nowTs]);

  const visualBlur = exempt ? false : !!(isNSFW || inCooldown || permanent);

  const overlayKind: NsfwOverlayKind = useMemo(() => {
    if (exempt) return 'none';
    if (permanent) return 'permanent';
    if (inCooldown) return 'cooldown';
    if (isNSFW) return 'live';
    return 'none';
  }, [exempt, permanent, inCooldown, isNSFW]);

  const blocksMatchmaking = exempt ? false : !!(permanent || inCooldown);

  return {
    visualBlur,
    overlayKind,
    cooldownRemainingSec,
    cooldownCountdownLabel: formatNsfwCountdown(cooldownRemainingSec),
    strikeCount,
    blocksMatchmaking,
    permanent,
  };
}
