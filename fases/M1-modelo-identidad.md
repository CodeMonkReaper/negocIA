# M1 — Modelo de identidad (`identity-core`)

| Campo | Valor |
|---|---|
| Fase | 1 (identidad) |
| Fecha | 24/09/2026 |
| Estado | **Completo** |
| Referencias normativas | `docs/database/schema.md`, `docs/architecture/authentication.md`, `docs/api/authentication.md`, ADR-005 (refresh reuse), ADR-007 (tenant limits) |

## 1. Contexto y objetivo

La Fase 1 consiste en el subsistema de identidad multi-tenant: autenticación JWT + refresh rotation, tenants/usuario/invitaciones y verificación de email. Antes de cualquier caso de uso, es necesario materializar en PostgreSQL el modelo de datos deliberado en `docs/database/schema.md`. Este hito **solo** entrega el modelo + migración; no hay código de aplicación (auth/endpoints) todavía.

Criterios de done:

1. 6 modelos en `schema.prisma` fieles a `schema.md`.
2. Migración SQL válida con invariantes raw (CHECKs, partial unique, índices parciales, índice `lower(email)`).
3. `prisma validate` + `migrate status` + `db:check` en verde.
4. Repo completo: `build`, `typecheck`, `lint` en verde.

Fuera de alcance: enums nativos de PG, `citext`, triggers, RLS, endpoints.

## 2. Modelo de datos

Archivo: `packages/database/prisma/schema.prisma`

| Modelo | Tabla | Propósito | FKs |
|---|---|---|---|
| `Tenant` | `tenants` | Organización plan/status | — |
| `User` | `users` | Usuario (email único global) | — |
| `Membership` | `memberships` | Relación tenant↔usuario con rol/status | tenant RESTRICT, user CASCADE |
| `RefreshToken` | `refresh_tokens` | Sesiones JWT con rotación | user CASCADE, self-FK `replacedBy` SET NULL |
| `Invitation` | `invitations` | Invitación pendiente a join | tenant CASCADE, invited_by RESTRICT, accepted_by SET NULL |
| `VerificationToken` | `verification_tokens` | Verificación de email 1-uso | user CASCADE |

Decisiones de mapeo (todas registradas contra `schema.md`):

- **IDs**: `gen_random_uuid()` generado en BD (`@default(dbgenerated("gen_random_uuid()"))`), nativo en PG17.
- **Timestamps**: `timestamptz`; `created_at` con `DEFAULT now()`; `updated_at` gestionado por aplicación (`@updatedAt` de Prisma), **sin triggers** (`schema.md §9.2`).
- **Enums**: `text` + CHECK, no `CREATE TYPE` (evolucionar un status = `DROP/ADD CONSTRAINT`, sin `ALTER TYPE` con locks).
- **Email**: `text` + UNIQUE + índice `lower(email)` en `users`; partial unique `(tenant_id, email) WHERE status='PENDING'` en `invitations`; fallback explícito a `citext` (evita extensión y drift Prisma↔PG). Normalización lower/trim queda en la capa de aplicación (M-4).
- **RefreshToken.replacedById `@unique`**: modela la cadena de rotación como 1-a-1 (un token solo puede ser reemplazado una vez) — prerequisito de detección de reuse (ADR-005).

## 3. Migración

Archivo: `packages/database/prisma/migrations/20260924012558_identity_core/migration.sql`

Flujo: `prisma migrate dev --create-only` (genera SQL base) → **edición manual** del SQL para invariantes raw → `prisma migrate dev` (aplica). Invariantes añadidas a mano:

1. **8 CHECKs** de enums:
   - `tenants.plan` (`BASIC|PRO|PREMIUM`, default `BASIC`)
   - `tenants.status` (`ACTIVE|SUSPENDED|DELETING`)
   - `users.status` (`PENDING_VERIFICATION|ACTIVE|DISABLED`)
   - `memberships.role` (`OWNER|ADMIN|AGENT`), `memberships.status` (`ACTIVE|INACTIVE`)
   - `invitations.role` (`OWNER|ADMIN|AGENT`), `invitations.status` (`PENDING|ACCEPTED|REVOKED`)
2. **Paridad** `(accepted_at IS NULL) = (accepted_by IS NULL)` en `invitations` (nunca uno sin el otro).
3. **Partial unique** en invitaciones: `(tenant_id, email) WHERE status='PENDING'` (a lo sumo una invitación activa por email+tenant).
4. **Índice parcial** `refresh_tokens(user_id) WHERE revoked_at IS NULL` (búsqueda de sesión activa).
5. **Índice funcional** `users(lower(email))` (respaldo de unicidad case-insensitive).

Ownership de FKs según semántica de borrado: `memberships.tenant` RESTRICT (no destruir tenant con miembros), `memberships.user` CASCADE (borrar miembro elimina membresías), invitaciones `tenant` CASCADE, `invited_by` RESTRICT, `accepted_by` SET NULL, tokens `user` CASCADE, self-FK `replacedBy` SET NULL.

## 4. Archivos

| Archivo | Cambio |
|---|---|
| `packages/database/prisma/schema.prisma` | +6 modelos de identidad |
| `packages/database/prisma/migrations/20260924012558_identity_core/migration.sql` | migración creada con `--create-only` y editada (SQL raw) |
| `docs/infrastructure/local-development.md` | nota del schema identity-core + migración |
| `docs/infrastructure/informe-implementacion-fundacion.md` | §13 (M-1) y tachado del ítem 1 de §12 |

## 5. Verificación (evidencia)

| Comando | Resultado |
|---|---|
| `prisma migrate dev` | Aplica `identity-core`; 6 tablas + `_prisma_migrations` en `negocia` |
| `prisma migrate status` | `Database schema is up to date!` |
| `prisma validate` | Schema válido, Prisma Client 7.10.0 regenerado |
| `information_schema` / `pg_indexes` | 8 CHECKs + 3 índices especiales confirmados |
| `pnpm db:check` | `PostgreSQL connection OK` |
| `pnpm build` | 5/5 paquetes |
| `pnpm typecheck` | 8/8 |
| `pnpm lint` | 8/8 |

## 6. Lecciones aprendidas

- Generar migraciones con `--create-only` permite inyectar invariantes SQL que Prisma no modela (CHECKs, partial unique) sin perder la capacidad `migrate dev status`.
- `@updatedAt` de Prisma **no se dispara con `updateMany`**: los casos de uso que lo usen deberán setear `updated_at` explícitamente (se documentó en M-1 e impacta M-4/M-5).
- Registrar las decisiones de bajo nivel contra el documento normativo (`schema.md`) evita duplicar contexto en el schema comentando.

## 7. Próximo paso

**M-2 — Infraestructura de API común** → documento `M2-infraestructura-api-comun.md` (completado).