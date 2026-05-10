"""Validación conservadora de edad mínima (cumpleaños al 31 dic del año declarado)."""
from datetime import date

MIN_REGISTER_AGE = 18


def is_at_least_age(birth_year: int, min_age: int = MIN_REGISTER_AGE) -> bool:
    if birth_year < 1900 or birth_year > date.today().year:
        return False
    birthday_in_year = date(birth_year, 12, 31)
    today = date.today()
    years = today.year - birthday_in_year.year
    if (today.month, today.day) < (birthday_in_year.month, birthday_in_year.day):
        years -= 1
    return years >= min_age
