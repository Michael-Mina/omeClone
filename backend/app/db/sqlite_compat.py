"""
Tablas ya existentes no ganan columnas nuevas con create_all().
Añade columnas faltantes del modelo User en SQLite y PostgreSQL.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.user import User


def ensure_user_table_columns(engine: Engine) -> None:
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table('users'):
        return

    existing = {c['name'] for c in insp.get_columns('users')}
    dialect = engine.dialect

    with engine.begin() as conn:
        for col in User.__table__.columns:
            if col.name == 'id' or col.name in existing:
                continue
            coltype = col.type.compile(dialect=dialect)
            sql = text(f'ALTER TABLE users ADD COLUMN {col.name} {coltype}')
            try:
                conn.execute(sql)
            except Exception:
                # Columna ya creada en otra ejecución concurrente / dialecto raro
                pass
