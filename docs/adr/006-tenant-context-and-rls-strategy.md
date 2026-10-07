# ADR-006 — Tenant context y estrategia RLS

- **Estado:** Aceptado (diseño completo en Fase 1; **activación progresiva en Fase 2**)
- **Fecha:** 2026-09-21
- **Ámbito:** Multi-tenancy / seguridad

## Contexto

Aislamiento lógico entre tenants. Workers/webhooks/tools no tienen JWT. RLS es parte del diseño del producto (PROJECT_CONTEXT §8, §9) como segunda capa.

## Decisión

1. **Modelo normalizado desde Fase 1:** toda tabla tenant-scoped tiene `tenant_id NOT NULL` + índice; operaciones siempre bajo `TenantContext` (source: `HTTP_JWT | WORKER_JOB | WEBHOOK | TOOL | SYSTEM`) propagado por `AsyncLocalStorage` (`architecture/tenant-context.md`).
2. **Capa primaria = aplicación:** guards resuelven el tenant/rol desde BD (nunca del cliente ni de claims). El diseño garantiza que, al activarse RLS después, las mismas queries sigan funcionando porque ya operan con el tenant correcto.
3. **RLS = segunda capa, activación progresiva:** se escribe la infraestructura (roles `app_tenant`, `app_migrator`, helper `app.set_tenant_id`/`app.get_tenant_id()`, políticas por tabla) en Fase 2.

### Orden de activación de RLS por tabla

1. Tablas tenant-scoped **nuevas** (nacen con RLS si se crean en Fase 2+; ej. `conversations`, `messages`).
2. `invitations` (tenant-scoped): política `tenant_id = app.get_tenant_id()`, FORCE para las mutaciones.
3. `memberships`: política híbrida `tenant_id = app.get_tenant_id() OR user_id = app.get_user_id()` — necesaria para `switch-tenant` y `/me` donde el usuario tiene varias memberships en tenants distintos.
4. `users` / `tenants`: políticas mínimas de perfil propio / propio tenant (las más sensibles; se activan al final y solo tras tests de aislamiento).
5. `refresh_tokens` / `verification_tokens`: system-scoped, sin políticas de tenant; rol `app_migrator`/dedicado con bypass.

### Condiciones de activación por tabla (gate)

- Políticas escritas y probadas en tests de integración (aislamiento + permisos).
- Toda operación tenant-scoped del código ya pasa por transacción con `SET LOCAL`.
- Los workers/webhooks ya tuyos context validado (Fase 2).
- Se ejecuta `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` en la migración de activación de esa tabla.

## Consecuencias

- Los workers reciben `tenantId` explícito en el job y lo **validan** contra BD antes de crear context (nunca JWT, nunca entorno).
- Cualquier nueva tabla tenant-scoped debe cumplir §8 de `multi-tenancy.md` desde el día 1 para no pagar refactor al activar RLS.
- Costo: diseño de políticas por tabla + monitoreo de `SET LOCAL` y de performance de RLS en Fase 2.

## Alternativas

- **Aislar por schema por tenant:** descartado (complejidad de migraciones ×N, costos, y PROJECT_CONTEXT pide aislamiento lógico).
- **DB por tenant:** descartado (costo/operación).
- **RLS total desde Fase 1:** descartado acordadamente; activación progresiva reduce riesgo mientras la capa de aplicación es primaria y seguro el cambio.