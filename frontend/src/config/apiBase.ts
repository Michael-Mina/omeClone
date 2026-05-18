/**
 * URL base del backend (REST + Socket.IO).
 *
 * Orden en producción (build):
 * 1) `VITE_BACKEND_URL` (.env / variables de CI)
 * 2) Convención Render del blueprint: mismo prefijo `-web` / `-api` en `*.onrender.com`
 *    (ej. `omeclone-web.onrender.com` → `https://omeclone-api.onrender.com`)
 * 3) Último recurso solo en local preview: puerto habitual del repo
 *
 * Desarrollo (`import.meta.env.DEV`): cadena vacía → `/api` y Socket.IO vía origen (proxy Vite).
 */

const LOCAL_PREVIEW_API = 'http://127.0.0.1:8002';

/** `omeclone-web.onrender.com` → `https://omeclone-api.onrender.com` */
function inferRenderSiblingApiOrigin(hostname: string): string | null {
  const h = hostname.toLowerCase();
  if (!h.endsWith('.onrender.com')) return null;
  const sub = hostname.slice(0, hostname.length - '.onrender.com'.length);
  const suffix = '-web';
  if (!sub.toLowerCase().endsWith(suffix)) return null;
  const base = sub.slice(0, -suffix.length);
  if (!base) return null;
  return `https://${base}-api.onrender.com`;
}

export function getBackendOrigin(): string {
  const v = import.meta.env.VITE_BACKEND_URL;
  if (typeof v === 'string' && v.trim() !== '') {
    return v.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return '';
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const inferred = inferRenderSiblingApiOrigin(window.location.hostname);
    if (inferred) return inferred;
  }
  return LOCAL_PREVIEW_API;
}

export function getSocketOrigin(): string {
  return (
    getBackendOrigin() ||
    (typeof window !== 'undefined' ? window.location.origin : LOCAL_PREVIEW_API)
  );
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendOrigin();
  return base === '' ? p : `${base}${p}`;
}

/** Solo avisa si ni variable ni heurística cubren la API en producción. */
export function warnIfProductionBackendMissing(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined') return;

  const v = import.meta.env.VITE_BACKEND_URL;
  if (typeof v === 'string' && String(v).trim()) return;

  if (inferRenderSiblingApiOrigin(window.location.hostname)) return;

  console.warn(
    '[Albedrío] Sin VITE_BACKEND_URL y el host no sigue *-web.onrender.com → *-api. ' +
      'Define VITE_BACKEND_URL en Render y redeploy (o renombra el static a …-web y el API a …-api).'
  );
}
