"""Edad mínima para sala adulta según país (debe coincidir con frontend legalAdultAge.ts)."""

DEFAULT_LEGAL_ADULT_AGE = 18

LEGAL_ADULT_AGE_BY_COUNTRY: dict[str, int] = {
    "US": 21,
    "CA": 19,
    "KR": 19,
    "JP": 20,
}


def normalize_country_code(country: str | None) -> str | None:
    if country is None:
        return None
    c = str(country).strip().upper()
    if not c or c == "OTHER":
        return None
    return c


def legal_adult_age_for_country(country: str | None) -> int:
    code = normalize_country_code(country)
    if not code:
        return DEFAULT_LEGAL_ADULT_AGE
    return LEGAL_ADULT_AGE_BY_COUNTRY.get(code, DEFAULT_LEGAL_ADULT_AGE)
