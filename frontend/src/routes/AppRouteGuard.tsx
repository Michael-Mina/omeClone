import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import App from '../App';
import { useAppStore } from '../store/useAppStore';
import { apiUrl } from '../config/apiBase';
import { socket } from '../sockets/socket';
import { ensureValidAccessToken } from '../utils/authSession';
import { meJsonToAccessBlock } from '../utils/salasAccessFromMe';

/** Videollamadas: solo si ya eligió sala en `/salas`. */
export function AppRouteGuard() {
  const { token, role, salaSessionActive } = useAppStore();
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!token?.trim()) {
        if (!cancelled) setSessionReady(true);
        return;
      }
      await ensureValidAccessToken();
      if (cancelled) return;

      const st = useAppStore.getState();
      if (!st.token?.trim()) {
        if (!cancelled) setSessionReady(true);
        return;
      }

      /** Evita /app directo con `salaSessionActive` persistido si la cuenta ya está restringida. */
      if (st.role !== 'superadmin' && st.salaSessionActive) {
        try {
          const fresh = (await ensureValidAccessToken()) ?? st.token;
          const r = await fetch(apiUrl('/api/auth/me'), {
            headers: { Authorization: `Bearer ${fresh}` },
          });
          if (r.ok && !cancelled) {
            const j = (await r.json()) as Record<string, unknown>;
            if (meJsonToAccessBlock(j).blocked) {
              socket.emit('cancel_matchmaking', {});
              useAppStore.getState().stopMatch();
              useAppStore.getState().setSalaSessionActive(false);
            }
          }
        } catch {
          /* sin red: no forzar salida de /app */
        }
      }

      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) return <Navigate to="/login" replace />;
  if (!sessionReady) {
    return (
      <p className="min-h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-400 text-sm m-0">
        Preparando sesión…
      </p>
    );
  }
  if (!useAppStore.getState().token?.trim()) {
    return <Navigate to="/login" replace />;
  }
  if (role === 'superadmin') return <Navigate to="/admin" replace />;
  if (!salaSessionActive) return <Navigate to="/salas" replace />;
  return <App />;
}
