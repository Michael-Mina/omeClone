import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import App from '../App';
import { useAppStore } from '../store/useAppStore';
import { ensureValidAccessToken } from '../utils/authSession';

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
