"""Ejecutar en la carpeta backend: python print-routes.py
Muestra que el código en disco tiene las rutas /health y /api/health."""
import sys

if __name__ == "__main__":
    from app import main as m

    print("app.main desde:", m.__file__)
    for r in m.app.routes:
        p = getattr(r, "path", None)
        mth = getattr(r, "methods", None)
        if p:
            print(f"  {p}  {mth or ''}")
