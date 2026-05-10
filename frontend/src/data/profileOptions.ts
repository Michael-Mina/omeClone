/** Listas cortas pero útiles para registro / anónimo. Códigos ISO 3166-1 alpha-2 cuando aplica. */

export const MIN_AGE = 18;

export const GENDER_OPTIONS = [
  { value: '', label: 'Selecciona…' },
  { value: 'mujer', label: 'Mujer' },
  { value: 'hombre', label: 'Hombre' },
  { value: 'no_binario', label: 'No binario / otro' },
  { value: 'prefiero_no_decir', label: 'Prefiero no decir' },
];

export const COUNTRY_OPTIONS = [
  { value: '', label: 'Selecciona país…' },
  { value: 'AR', label: 'Argentina' },
  { value: 'BO', label: 'Bolivia' },
  { value: 'BR', label: 'Brasil' },
  { value: 'CL', label: 'Chile' },
  { value: 'CO', label: 'Colombia' },
  { value: 'CR', label: 'Costa Rica' },
  { value: 'CU', label: 'Cuba' },
  { value: 'EC', label: 'Ecuador' },
  { value: 'ES', label: 'España' },
  { value: 'US', label: 'Estados Unidos' },
  { value: 'MX', label: 'México' },
  { value: 'GT', label: 'Guatemala' },
  { value: 'HN', label: 'Honduras' },
  { value: 'NI', label: 'Nicaragua' },
  { value: 'PA', label: 'Panamá' },
  { value: 'PY', label: 'Paraguay' },
  { value: 'PE', label: 'Perú' },
  { value: 'PR', label: 'Puerto Rico' },
  { value: 'DO', label: 'Rep. Dominicana' },
  { value: 'UY', label: 'Uruguay' },
  { value: 'VE', label: 'Venezuela' },
  { value: 'DE', label: 'Alemania' },
  { value: 'FR', label: 'Francia' },
  { value: 'IT', label: 'Italia' },
  { value: 'GB', label: 'Reino Unido' },
  { value: 'CA', label: 'Canadá' },
  { value: 'OTHER', label: 'Otro' },
];

export const LANGUAGE_OPTIONS = [
  { value: '', label: 'Selecciona idioma…' },
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'fr', label: 'Francés' },
  { value: 'de', label: 'Alemán' },
  { value: 'it', label: 'Italiano' },
  { value: 'OTHER', label: 'Otro' },
];

/** Años elegibles solo si tienen como mínimo MIN_AGE (aprox.: año actual − MIN_AGE). */
export function getBirthYearsDescending(): number[] {
  const y = new Date().getFullYear();
  const maxYear = y - MIN_AGE;
  const oldest = maxYear - 82;
  const out: number[] = [];
  for (let yr = maxYear; yr >= oldest; yr--) out.push(yr);
  return out;
}

export function genderLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return GENDER_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function countryLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return COUNTRY_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function languageLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return LANGUAGE_OPTIONS.find((o) => o.value === code)?.label ?? code;
}
