import {
  adultZoneBadge,
  adultZoneLabel,
  adultZoneSubtitle,
} from '../data/legalAdultAge';

/** Sala de videollamada: moderada (IA + sanciones) o adulta (sin ambas). */
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

export {
  getLegalAdultAge,
  adultZoneBadge,
  adultZoneLabel,
  adultZoneSubtitle,
  userMeetsAdultZone,
  adultZoneBlockedHint,
} from '../data/legalAdultAge';

/** Textos de sala adulta según país del perfil. */
export function getAdultZoneDisplay(country: string | null | undefined) {
  return {
    label: adultZoneLabel(country),
    subtitle: adultZoneSubtitle(country),
    badge: adultZoneBadge(country),
    accent: MATCH_ZONE_META.adult.accent,
  };
}
