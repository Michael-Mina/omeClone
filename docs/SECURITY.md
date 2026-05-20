# Recomendaciones de seguridad y despliegue (Albedrío / omeTV)

## Autenticación y API

- No expongas `SECRET_KEY` ni claves de Stripe en el frontend; usa solo `STRIPE_PUBLISHABLE_KEY` en el cliente.
- Prefiere **restricted keys** en Stripe con permisos mínimos; verifica **firma de webhooks**.
- El rate limiting por IP en rutas `/api/auth/*` y `nsfw-strike` reduce abuso; detrás de proxy, configura bien `X-Forwarded-For` si necesitas la IP real.

## Moderación y datos

- Los registros de **admin_audit_log** permiten trazar baneos y cambios de exenciones; conserva backups de la BD.
- SQLite es adecuado para desarrollo y tráfico moderado; en producción con mucha concurrencia valorar PostgreSQL.

## Salud del servicio

- `GET /api/health` incluye comprobación de base de datos; úsalo en balanceadores y alertas (503 si falla).

## Soporte / apelaciones

- Configura `VITE_SUPPORT_EMAIL` en el build del frontend para mostrar contacto en pantallas de suspensión.
