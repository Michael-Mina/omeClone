# Frontend en Render (Static Site)

El front es un build **Vite/React**; Render lo publica como **Static Site** (CDN, HTTPS).

### Si el build sale con **exit 1**

Muchas veces Render exporta **`NODE_ENV=production`** antes de `npm ci`, y npm **no instala `devDependencies`** (falta Vite, TypeScript, etc.). Usa en el build: **`npm ci --include=dev`** (ya va en `render.yaml` y en la tabla de abajo).

## Desde el Blueprint del repo (`render.yaml`)

El archivo `render.yaml` ya incluye el servicio **`albedrio-web`** (`runtime: static`).

1. En [Render Dashboard](https://dashboard.render.com) → tu **Blueprint** del repo `omeClone`.
2. **Manual sync** (o push a `main` si el blueprint auto-sincroniza).
3. Cuando pida variables del sitio estático, define:
   - **`VITE_BACKEND_URL`** = URL base de tu API en Render, por ejemplo `https://albedrio-api.onrender.com` (sin `/` final).
4. Espera el build. La URL será tipo `https://albedrio-web.onrender.com`.

**Regla SPA:** el blueprint lleva una **rewrite** `/*` → `/index.html`. Si un archivo existe (p. ej. `/assets/index-xyz.js`), Render lo sirve; si no, devuelve el HTML de la SPA (útiles rutas `/login`, `/admin` al recargar).

**`staticPublishPath` con `rootDir: frontend`:** debe ser **`./dist`**, no `./frontend/dist`; si no, Render no encuentra la carpeta tras el build.

## Crear solo el Static Site a mano (sin tocar el Blueprint)

1. **New** → **Static Site** → conecta **`Michael-Mina/omeClone`**, rama **`main`**.
2. Configuración:

   | Campo | Valor |
   |--------|--------|
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm ci --include=dev && env VITE_BASE_PATH=/ npm run build` |
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
- Si usas **`VITE_BACKEND_URL`**, tras cambiarla hay que **volver a desplegar** el Static Site para inyectarla en el bundle.

### Inferencia `…-web` / `…-api` en Render

Si el dominio del front es **`algo-web.onrender.com`**, el cliente usa **`https://algo-api.onrender.com`** cuando no hay **`VITE_BACKEND_URL`** (coincide con **`albedrio-web`** / **`albedrio-api`** del blueprint). Así se evita **`localhost`** en producción.

Para otros nombres de servicio, define **`VITE_BACKEND_URL`** y redeploy.

### «Error de conexión con el servidor» en login/registro

1. **F12 → Red:** las peticiones deben ir al API en **`https://….onrender.com`**, no a `localhost`.
2. Si el host no cumple `*-web.onrender.com`: **Environment** → **`VITE_BACKEND_URL`** + nuevo deploy.
3. El API en plan gratis puede estar «dormido» (~1 min el primer request); reintenta.
