/** Sala de videollamada: moderada (IA + sanciones) o +18 (sin ambas). */
export type MatchZone = 'moderated' | 'adult';

export const DEFAULT_MATCH_ZONE: MatchZone = 'moderated';

export const MATCH_ZONE_META: Record<
  MatchZone,
  { label: string; subtitle: string; badge: string; accent: string }
> = {
  moderated: {
    label: 'Sala estándar',
    subtitle: 'Censura por IA activa y sistema de avisos / bloqueos.',
    badge: 'Moderada',
    accent: 'from-blue-600 to-indigo-600',
  },
  adult: {
    label: 'Sala +18',
    subtitle: 'Sin censura IA ni sanciones automáticas. Solo mayores de edad.',
    badge: '+18',
    accent: 'from-rose-600 to-orange-600',
  },
};

export function buildMatchmakingFilters(zone: MatchZone): { match_zone: MatchZone } {
  return { match_zone: zone };
}

/** Mayoría de edad según año de nacimiento del perfil. */
export function userMeetsAdultZone(birthYear: number | null | undefined): boolean {
  if (birthYear == null || !Number.isFinite(birthYear)) return false;
  return new Date().getFullYear() - birthYear >= 18;
}
