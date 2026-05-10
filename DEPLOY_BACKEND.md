# Desplegar el API (paso 1)

Objetivo: una URL **HTTPS** pública para el backend (FastAPI + Socket.IO).

## Opción recomendada: Postgres en Neon + API en Render

### A) Base de datos (gratis)

1. Crea cuenta en [Neon](https://neon.tech) → **Create project**.
2. Copia la cadena **connection string** (empieza por `postgres://` o `postgresql://`).

### B) API en Render

1. Cuenta en [Render](https://render.com) → **New** → **Blueprint**.
2. Conecta el repo `Michael-Mina/omeClone` y usa el archivo `render.yaml` de la raíz  
   (o **Web Service** manual: **Docker**, contexto `backend`, Dockerfile `backend/Dockerfile`).
3. En **Environment** del servicio web añade:
   - `DATABASE_URL` = la cadena de Neon (tal cual).
   - `SECRET_KEY` = una cadena larga aleatoria (o la que genere Render si usas blueprint).
4. **Deploy**. Cuando termine, tendrás una URL tipo `https://omeclone-api.onrender.com`.

### C) Probar

En el navegador: `https://TU-URL.onrender.com/health` → debe responder JSON con `"service": "ometv-api"`.

### D) Superusuario (admin web)

Con `DATABASE_URL` apuntando al mismo Neon (variable en tu `.env` local):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
set DATABASE_URL=postgres://...   # la misma que Neon
python create_superuser.py admin@tudominio.com TuPasswordSegura
```

### E) Frontend

En Cloudflare Pages / build local:

- `VITE_BACKEND_URL=https://TU-URL.onrender.com` (sin barra final).

**Nota:** El plan gratuito de Render puede **enfriar** el servicio tras inactividad; el primer request tarda ~1 minuto.
