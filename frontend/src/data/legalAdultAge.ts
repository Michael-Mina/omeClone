/**
 * Edad mínima para la sala adulta según país del perfil (ISO 3166-1 alpha-2).
 * Por defecto 18; algunos territorios exigen más (p. ej. EE. UU. → 21).
 */
export const DEFAULT_LEGAL_ADULT_AGE = 18;

/** Edad mínima en sala adulta por código de país. */
export const LEGAL_ADULT_AGE_BY_COUNTRY: Record<string, number> = {
  US: 21,
  CA: 19,
  KR: 19,
  JP: 20,
};

export function normalizeCountryCode(country: string | null | undefined): string | null {
  if (country == null) return null;
  const c = String(country).trim().toUpperCase();
  if (!c || c === 'OTHER') return null;
  return c;
}

export function getLegalAdultAge(country: string | null | undefined): number {
  const code = normalizeCountryCode(country);
  if (!code) return DEFAULT_LEGAL_ADULT_AGE;
  return LEGAL_ADULT_AGE_BY_COUNTRY[code] ?? DEFAULT_LEGAL_ADULT_AGE;
}

export function adultZoneBadge(country: string | null | undefined): string {
  return `+${getLegalAdultAge(country)}`;
}

export function adultZoneLabel(country: string | null | undefined): string {
  return `Sala ${adultZoneBadge(country)}`;
}

export function adultZoneSubtitle(country: string | null | undefined): string {
  const age = getLegalAdultAge(country);
  return `Sin censura IA ni sanciones automáticas. Solo mayores de ${age} años.`;
}

export function userMeetsAdultZone(
  birthYear: number | null | undefined,
  country: string | null | undefined
): boolean {
  if (birthYear == null || !Number.isFinite(birthYear)) return false;
  const minAge = getLegalAdultAge(country);
  return new Date().getFullYear() - birthYear >= minAge;
}

export function adultZoneBlockedHint(country: string | null | undefined): string {
  const age = getLegalAdultAge(country);
  return `Indica tu año de nacimiento en el perfil (mayor de ${age} años en tu país) para entrar a la sala ${adultZoneBadge(country)}.`;
}
