# ADR-005 — Auth autogestionada: JWT mínimo + refresh rotation + principal por request

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Identidad / seguridad

## Contexto

Multi-tenant con membresías y roles por tenant, revocaciones y cambios de rol frecuentes. Se evaluó Supabase Auth vs auth propia.

## Decisión

Auth **autogestionada** en NestJS:

1. **Access JWT corto (15 min)** con claims mínimos: `sub`, `jti`, `tenant_id` activo. Sin roles/permisos/negocio.
2. **Refresh token opaco rotativo** (30 días), almacenado como hash SHA-256 en `refresh_tokens`, con encadenamiento de familia (`replaced_by_token_id`) y **detección de reuse** (revoca toda la familia si un token ya rotado/reusado vuelve).
3. **Password Argon2id** detrás del puerto `PasswordHasher` (parámetros centralizados; nunca loggear).
4. **Principal por request**: identidad desde JWT, pero membership/rol/estado se releen de PostgreSQL en cada request. **El JWT no es fuente de verdad de autorización.**

## Consecuencias

- Revocación y cambio de rol efectivos inmediatos (no esperar expiración del JWT).
- Costo: un read de membership por request autenticado (aceptable en MVP). Cache corta se evaluará con métricas; la decisión queda registrada para no introducirla prematuramente.
- `switch-tenant` emite nueva sesión validando la membership objetivo en BD.

## Alternativas

- **Supabase Auth:** desacopla identidad pero acopla a Supabase, complica el modelo multi-membership con roles propios (OWNER/ADMIN/AGENT) y la personalización (reuse detection, invitaciones custom). Rechazado para el core de identidad. Supabase puede seguir siendo hosting de Postgres.
- **Auth libraries (Clerk/Auth0):** sobrecosto SaaS para un segmento B2B con invitaciones por tenant y necesidad de control; puede reconsiderarse en fases comerciales posteriores.
- **JWT como fuente de permisos (RBAC en claims):** descartado (claims obsoletos; revocación lenta; robo de token).

## Decisión secundaria (registrada)

Argon2id como primera opción de hashing con `argon2`; se fijó SÍ sobre bcrypt por resistencia a GPU fuerte; encapsulado en `PasswordHasher` por testabilidad y aislamiento del cambio.