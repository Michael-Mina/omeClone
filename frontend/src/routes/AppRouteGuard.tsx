import { Navigate } from 'react-router-dom';
import App from '../App';
import { useAppStore } from '../store/useAppStore';

/** Videollamadas: solo si ya eligió sala en `/salas`. */
export function AppRouteGuard() {
  const { token, role, salaSessionActive } = useAppStore();

  if (!token) return <Navigate to="/login" replace />;
  if (role === 'superadmin') return <Navigate to="/admin" replace />;
  if (!salaSessionActive) return <Navigate to="/salas" replace />;
  return <App />;
}
