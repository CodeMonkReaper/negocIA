# ADR-009 — Proveedor de email real y recuperación de contraseña (F2-1/F2-2)

- **Estado:** Aceptado
- **Fecha:** 2026-10-03
- **Ámbito:** Identidad / onboarding / canal de email

## Contexto

Fase 1 quedó cerrada (M-5) con el email entregado por `MockEmailAdapter` (ADR-008, punto 4) y sin recuperación de contraseña — ambos marcados como "pendientes de cierre". Para arrancar Fase 2 (WhatsApp/LLM) se necesita un canal de email de producción y cerrar el flujo de restablecimiento de contraseña, que dependía de la decisión de proveedor.

## Decisión

1. **Proveedor de email: Resend** (SDK oficial `resend`). El driver se elige con `EMAIL_DRIVER` (`mock | resend`), validado en `validateEnv`:
   - `RESEND_API_KEY` es obligatoria **solo** cuando `EMAIL_DRIVER=resend`; con `mock` el cliente Resend ni se instancia.
   - `EMAIL_DRIVER=mock` con `NODE_ENV=production` es **error de arranque**: el mock solo es un buffer de test, y olvidarse haría que producción "enviara" correos al vacío.
   - `APP_BASE_URL` es la base de los enlaces de acción (`/verificar-email`, `/invitacion`, `/restablecer-password`); se valida como http(s) sin path.
2. **`ResendEmailAdapter`** renderiza texto y HTML en español con escape de datos de usuario (anti-XSS en el HTML) y **traga** los errores del proveedor (log `warn`): el token ya quedó persistido antes de `send`, así que una caída de Resend no rompe el alta/el reset y el usuario puede pedir el envío otra vez. `MockEmailAdapter` se mantiene y sigue exportado para los tests (`app.get(MockEmailAdapter)`).
3. **Recuperación de contraseña con dominio y tabla propios** (`password_reset_tokens`), no reusando `verification_tokens`:
   - Token opaco de **1-uso**, persistido solo como hash SHA-256, TTL **15 min** (`RESET_TOKEN_TTL_SECONDS`).
   - Errores literales y uniformes: token inválido, vencido o usado → `400 invalid_token` (mismo principio anti-oráculo que invitaciones/verificación).
   - Emisión (`POST /v1/auth/forgot-password`): respuesta **uniforme 204** con email inexistente/deshabilitado/envío (no enumerar cuentas). En la misma transacción se invalidan los resets PENDING previos del usuario: solo puede existir un reset vivo.
   - Consumo (`POST /v1/auth/reset-password`): `assertPasswordPolicy` + hash Argon2id **antes** de la transacción (no retener bloqueos de fila ~50 ms). El `UPDATE … WHERE used_at IS NULL` da el 1-uso atómico; el token vencido se **consume y confirma** (commit) antes de lanzar el `invalid_token`; tras el cambio se invalidan los demás pendientes y se **revocan todas las sesiones** del usuario (`revokeAllForUser`).
   - Se unificará en una tabla genérica de tokens solo si aparecen 4+ tipos (nota de ADR-008). 
4. **`PasswordResetSender`** espejo de `EmailVerificationSender` (mismo patrón de persistir-antes-de-enviar).

## Consecuencias

- `apps/api` agrega la dependencia `resend` (lockfile), y `@negocia/database` una migración más (`password_reset_tokens`).
- `EmailModule` (nuevo) es el composition root del email; `AuthModule` lo importa y lo **re-exporta** (ya no registra `EMAIL_SENDER` directamente), manteniendo `EMAIL_SENDER` y `MockEmailAdapter` visibles para `InvitationsModule` y los e2e.
- `validateEnv` valida 6 variables nuevas; `api-environment.spec.ts` las cubre (26 tests en ese momento; la suite actual suma 34 tests con las variables de WhatsApp de M7).
- La paridad "el password nunca sale por la API" se mantiene: el token de reset solo viaja por email y como hash en BD.

## Alternativas

- **SMTP/SES directos**: más configuración (host, credenciales, TLS, whitelist) sin ventaja sobre el SDK; se descarta por simplicidad y velocidad de entrega.
- **Reusar `verification_tokens` para el reset**: mezclaría dominios con TTL distintos (24 h vs 15 min) y ciclos de vida distintos; se descarta (dropa el criterio de ADR-008).
- **Devolver el token en la API**: descartado — sería una credencial de reset entregada por un canal que ya autenticó.
- **`EMAIL_DRIVER=mock` permitido en prod**: descartado por el guard de arranque (riesgo de enviar "de mentira" en producción).