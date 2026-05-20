/**
 * Misma regla que en /salas: si el usuario no puede usar videollamadas
 * (baneo, suspensión o cooldown IA), debe validarse contra GET /api/auth/me.
 */
export type SalasAccessBlock =
  | { blocked: false }
  | { blocked: true; kind: 'permanent' | 'moderation' | 'cooldown'; untilMs?: number };

export function meJsonToAccessBlock(data: Record<string, unknown>): SalasAccessBlock {
  if (data.is_superuser === true || data.exempt_from_ban === true) {
    return { blocked: false };
  }
  const perm = Boolean(data.nsfw_permanent_ban);
  const modBan = Boolean(data.is_banned) && !perm;
  const raw = data.nsfw_ban_until;
  let untilMs: number | undefined;
  if (raw != null && String(raw).trim() !== '') {
    let s = String(raw).trim();
    if (!s.includes('T') && s.includes(' ')) s = s.replace(' ', 'T');
    const hasTz = /Z$/i.test(s) || /[+-]\d{2}:\d{2}$/.test(s);
    const ms = hasTz ? Date.parse(s) : Date.parse(s.replace(/\.\d+$/, '') + 'Z');
    if (Number.isFinite(ms)) untilMs = ms;
  }
  const inCooldown = untilMs != null && untilMs > Date.now() + 2000;
  if (perm) return { blocked: true, kind: 'permanent' };
  if (modBan) return { blocked: true, kind: 'moderation' };
  if (inCooldown) return { blocked: true, kind: 'cooldown', untilMs };
  return { blocked: false };
}
