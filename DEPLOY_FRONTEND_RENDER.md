# Frontend en Render (Static Site)

El front es un build **Vite/React**; Render lo publica como **Static Site** (CDN, HTTPS).

## Desde el Blueprint del repo (`render.yaml`)

El archivo `render.yaml` ya incluye el servicio **`omeclone-web`** (`runtime: static`).

1. En [Render Dashboard](https://dashboard.render.com) → tu **Blueprint** del repo `omeClone`.
2. **Manual sync** (o push a `main` si el blueprint auto-sincroniza).
3. Cuando pida variables del sitio estático, define:
   - **`VITE_BACKEND_URL`** = URL base de tu API en Render, por ejemplo `https://omeclone-api.onrender.com` (sin `/` final).
4. Espera el build. La URL será tipo `https://omeclone-web.onrender.com`.

**Regla SPA:** el blueprint lleva una **rewrite** `/*` → `/index.html`. Si un archivo existe (p. ej. `/assets/index-xyz.js`), Render lo sirve; si no, devuelve el HTML de la SPA (útiles rutas `/login`, `/admin` al recargar).

## Crear solo el Static Site a mano (sin tocar el Blueprint)

1. **New** → **Static Site** → conecta **`Michael-Mina/omeClone`**, rama **`main`**.
2. Configuración:

   | Campo | Valor |
   |--------|--------|
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm ci && npm run build:cloudflare` |
   | **Publish Directory** | `dist` |

3. **Environment** (Variables):
   - **`VITE_BACKEND_URL`** = tu API HTTPS (misma URL que usas para probar `/health` en el servidor, sin `/` final).

4. Opcional: **Redirects / Rewrites** → **Rewrite**  
   - **Source:** `/*`  
   - **Destination:** `/index.html`  
   (Misma lógica que el blueprint.)

5. **Create Static Site** y espera el deploy.

## Comprobar

- Abres la URL `onrender.com` del static site → debe cargar la app (no pantalla en blanco).
- En **Network** debe haber **`/assets/index-....js`**, **no** `main.tsx`.

## Coordenadas con la API

- El backend ya tiene **CORS** abierto (`allow_origins=["*"]`).
- Tras cambiar **`VITE_BACKEND_URL`**, hay que **volver a desplegar** el Static Site para que el JS generado lleve la URL correcta.
