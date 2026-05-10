-- Otorgar rol de superadmin (panel /admin) en PostgreSQL (Neon).
-- El backend usa la columna users.is_superuser = true.
--
-- Paso 1: entra una vez con Google para que exista tu fila. Luego lista usuarios recientes:
--   SELECT id, email, oauth_google_sub, display_name, is_superuser, created_at
--   FROM users ORDER BY id DESC LIMIT 30;
--
-- Paso 2: elige UNA fila y ejecuta UNA de estas sentencias (ajusta valores):

-- Por email que devolvió Google:
UPDATE users SET is_superuser = true WHERE email = 'tu.correo@gmail.com';

-- Por ID numérico visto en la lista:
-- UPDATE users SET is_superuser = true WHERE id = 42;

-- Por sub estable de Google (claims.sub del token; columna oauth_google_sub):
-- UPDATE users SET is_superuser = true WHERE oauth_google_sub = '123456789012345678901';

-- Comprobar:
-- SELECT id, email, is_superuser FROM users WHERE is_superuser = true;
