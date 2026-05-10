import { Navigate } from 'react-router-dom';

/** El registro con correo está desactivado; las cuentas son con Google (o sesión anónima). */
export default function Register() {
  return <Navigate to="/login" replace />;
}
