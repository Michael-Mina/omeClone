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
