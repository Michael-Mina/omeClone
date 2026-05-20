
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import SalasPage from './pages/SalasPage';
import { AppRouteGuard } from './routes/AppRouteGuard';
import Register from './pages/Register';
import AdminDashboard from './pages/AdminDashboard';
import AdminMonitorWall from './pages/AdminMonitorWall';
import Profile from './pages/Profile';
import PremiumPage from './pages/PremiumPage';
import { useAppStore } from './store/useAppStore';

/** Evita enviar a /login antes de que zustand restaure token desde localStorage (F5). */
function HydrationGate({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(() =>
    typeof window !== 'undefined' ? useAppStore.persist.hasHydrated() : true
  );

  useEffect(() => {
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-400 text-sm">
        Cargando sesión…
      </div>
    );
  }
  return <>{children}</>;
}

export const Router = () => {
  const { token, role } = useAppStore();

  const getDashboardRoute = () => {
    if (!token) return "/login";
    return role === 'superadmin' ? '/admin' : '/salas';
  };

  /** Coincide con `base` de Vite (GitHub Pages en subruta, p. ej. `/omeClone/`). */
  const routerBasename =
    import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <BrowserRouter basename={routerBasename}>
      <HydrationGate>
        <Routes>
          {/* If user is logged in, redirect to app or admin, else to login */}
          <Route path="/login" element={!token ? <Login /> : <Navigate to={getDashboardRoute()} />} />
          <Route path="/register" element={!token ? <Register /> : <Navigate to={getDashboardRoute()} />} />

          {/* Elegir sala antes de videollamadas */}
          <Route
            path="/salas"
            element={
              token && role !== 'superadmin' ? (
                <SalasPage />
              ) : (
                <Navigate to={!token ? '/login' : '/admin'} replace />
              )
            }
          />

          {/* Videollamadas (requiere haber pasado por /salas) */}
          <Route
            path="/app"
            element={
              token && role !== 'superadmin' ? (
                <AppRouteGuard />
              ) : (
                <Navigate to={!token ? '/login' : '/admin'} replace />
              )
            }
          />

          {/* Protected admin route */}
          <Route
            path="/admin"
            element={
              token && role === 'superadmin' ? (
                <AdminDashboard />
              ) : (
                <Navigate to={!token ? '/login' : '/salas'} replace />
              )
            }
          />
          <Route
            path="/admin/monitors"
            element={
              token && role === 'superadmin' ? (
                <AdminMonitorWall />
              ) : (
                <Navigate to={!token ? '/login' : '/salas'} replace />
              )
            }
          />

          {/* Profile */}
          <Route path="/profile" element={token ? <Profile /> : <Navigate to="/login" />} />
          <Route path="/premium" element={token ? <PremiumPage /> : <Navigate to="/login" />} />

          {/* Default route */}
          <Route path="*" element={<Navigate to={getDashboardRoute()} />} />
        </Routes>
      </HydrationGate>
    </BrowserRouter>
  );
};
