/**
 * URL base del backend (REST + Socket.IO).
 *
 * Si existe `VITE_BACKEND_URL` en `.env`, se usa siempre (desarrollo y producción):
 * conexión directa al uvicorn, sin depender del proxy de Vite (evita fallos de login).
 *
 * Si no hay variable: en dev rutas relativas `/api` → proxy Vite; en build, localhost:8002 (mismo puerto que run-api).
 */
export function getBackendOrigin(): string {
  const v = import.meta.env.VITE_BACKEND_URL;
  if (typeof v === 'string' && v.trim() !== '') {
    return v.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return '';
  }
  return 'http://localhost:8002';
}

export function getSocketOrigin(): string {
  return getBackendOrigin() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8002');
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = getBackendOrigin();
  return base === '' ? p : `${base}${p}`;
}

/** Aviso en consola si el bundle de producción se generó sin API (caso habitual en Render). */
export function warnIfProductionBackendMissing(): void {
  if (!import.meta.env.PROD) return;
  const v = import.meta.env.VITE_BACKEND_URL;
  if (typeof v !== 'string' || !String(v).trim()) {
    // eslint-disable-next-line no-console
    console.error(
      '[omeClone] El build NO incluyó VITE_BACKEND_URL → el cliente usa http://localhost:8002 ' +
        'y login/registro fallan en el sitio público. En Render (Static Site): Environment → ' +
        'VITE_BACKEND_URL = https://tu-api.onrender.com → redeploy (nuevo build).'
    );
  }
}
