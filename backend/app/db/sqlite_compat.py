"""
Tablas ya existentes no ganan columnas nuevas con create_all().
Añade columnas faltantes del modelo User en SQLite y PostgreSQL.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.user import User
from app.models.system_settings import SystemSettings


def _ensure_table_columns(engine: Engine, table_name: str, model_table) -> None:
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table(table_name):
        return

    existing = {c['name'] for c in insp.get_columns(table_name)}
    dialect = engine.dialect

    with engine.begin() as conn:
        for col in model_table.columns:
            if col.name == 'id' or col.name in existing:
                continue
            coltype = col.type.compile(dialect=dialect)
            sql = text(f'ALTER TABLE {table_name} ADD COLUMN {col.name} {coltype}')
            try:
                conn.execute(sql)
            except Exception:
                pass


def ensure_user_table_columns(engine: Engine) -> None:
    _ensure_table_columns(engine, 'users', User.__table__)


def ensure_system_settings_columns(engine: Engine) -> None:
    _ensure_table_columns(engine, 'system_settings', SystemSettings.__table__)
