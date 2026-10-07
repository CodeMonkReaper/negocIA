# 1. Objetivo

Definir las capas de defensa que garantizan el aislamiento entre tenants y la protección de la identidad, y las reglas que **nunca** deben violarse.

# 2. Asunción de adversario

Se diseña asumiendo que:

- el cliente puede modificar cualquier request;
- el LLM puede equivocarse;
- Meta puede reenviar eventos (webhooks duplicados);
- dos workers pueden ejecutarse simultáneamente;
- un usuario puede intentar acceder a otro tenant;
- un proveedor externo puede fallar;
- un job puede ejecutarse más de una vez;

El sistema debe tolerar estas situaciones sin vulnerar el aislamiento.

# 3. Capas de defensa (tenant isolation)

```text
Capa 1 — Aplicación (primaria, Fase 1)
   • TenantContext obligatorio en operaciones tenant-scoped
   • tenant_id nunca proviene del cliente
   • queries siempre filtradas por tenant

Capa 2 — Authorization
   • principal resuelto por request desde BD (membership + rol + estados)
   • roles por membership; acciones protegidas por decorators de rol

Capa 3 — RLS en PostgreSQL (Fase 2, progressive)
   • políticas por tabla refuerzan tenant_id en la BD
   • defensa ante bug de aplicación o query mal filtrada
```

**Nunca hacer:**
- `GET /orders?tenant_id=123` o equivalente confiando el tenant desde el cliente.
- Leer el tenant de headers, body o query.
- Autorizar con claims del JWT como fuente de verdad.
- Ejecutar SQL dinámico a partir de la entrada del LLM.
- Exponer datos de un tenant sin contexto validado.

# 4. Roles y autorización

Roles `OWNER > ADMIN > AGENT` por membership. El rol proviene de la BD en cada request (no del JWT). Ver matriz en `architecture/authentication.md` §9.

Reglas:
- Cambios de rol/estado son operaciones auditables (quién, cuándo, desde qué sesión).
- Un ADMIN no puede gestionar billing del OWNER; un AGENT no invita usuarios.
- SUPER_ADMIN (interno, no por defecto) opera con contexto `SYSTEM` y solo para operaciones del SaaS (suspender tenant, soporte) — se documenta con sus límites en la iteración que se introduzca.

# 5. Invitaciones y verificación de email (seguridad)

- Los tokens de invitación y de verificación se almacenan **solo como hash** (SHA-256) y son **de un solo uso**.
- Invitación:
  - Solo `OWNER`/`ADMIN` pueden crear (`POST /v1/invitations`).
  - `invited_by` se registra (auditoría).
  - Rol propuesto se registra en la invitación; al aceptar se crea la membership con ese rol.
  - La aceptación la realiza el usuario autenticado cuyo email coincide con `invitations.email`.
  - Consumo atómico: `UPDATE invitations SET status='ACCEPTED', accepted_at=now(), accepted_by=:uid WHERE id=:id AND token_hash=:hash AND status='PENDING'` — si afecta 0 filas, token inválido/ya usado.
- Verificación de email: token 1-uso → `users.email_verified_at`.
- Expiración: invitación y verificación caducan (`expires_at`).
- Rate limiting en endpoints de invitación y resend para mitigar abuso/barrido de emails.

# 6. Autenticación (seguridad)

- Argon2id con parámetros configurados; sin log de passwords/hashes.
- Refresh rotation + detección de reuse (revoca familia) — `architecture/authentication.md` §5.
- JWT firmado con secret generado aleatoriamente (longitud ≥ 32 bytes) desde ENV; rotación de secret soportada.
- Logout y revoke-all (cambio de password → revocar sesiones).
- Protección contra enumeración de emails en login.
- HTTPS en producción (terminación TLS en el edge, p. ej. Cloudflare).

# 7. Validación de entrada

- DTOs con `class-validator` en todos los endpoints (tipos, formatos, tamaños).
- ENV validado con `validateEnv` (manual) al boot (falla rápido si falta/corre algo).
- IDs (uuid) validados con formato estricto.
- Normalización de email (lowercase/trim) en entrada y BD.

# 8. Idempotencia (preparación para webhooks)

Aunque los webhooks llegan en Fase 2, `packages/contracts` y el esquema ya contemplan:
- `provider_event_id` / `provider_message_id` con **unique constraint** para dedup;
- persistencia + dedup antes de encolar; HTTP 200 rápido; procesamiento pesado en BullMQ.

# 9. Secretos y logs

- Secretos: ENV + secret manager (Cloudflare/equivalente). Nunca en el repositorio (`.env*` en `.gitignore`, `.env.example` con placeholders).
- Logs: `StructuredLogger` con umbral `LOG_LEVEL`; no se loguean tokens, secrets ni datos sensibles innecesarios.
- Correlation id + tenant_id en logs solo cuando es seguro.

# 10. Auditoría (previsión)

Se introduce una tabla `audit_logs` (Fase 2) para mutaciones sensibles: invitaciones, cambios de rol, suspensión de tenant, logins. En Fase 1, los campos `created_at`/`updated_at` y `invited_by`/`accepted_by` ya permiten trazar los cambios de identidad.