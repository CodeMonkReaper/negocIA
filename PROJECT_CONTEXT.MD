# PROJECT CONTEXT — negocIA (actual)

> Documento maestro de contexto, generado por auditoría integral (septiembre 2026).
> **Sustituye** a `PROJECT_CONTEXT.MD`, cuyo contenido de diseño de producto quedó preservado en `docs/legacy/project-context-diseno-original.md`.
> Fuente de verdad: **código**. La documentación se cita como referencia y cualquier conflicto queda explícitamente registrado en "Documentación vs implementación".

---

## 1. Resumen del proyecto

SaaS B2B multi-tenant para PyMEs de Chile/LATAM: un asistente de IA que atiende WhatsApp (ventas + agendamiento). Usa backend NestJS + web Next.js/Tailwind, PostgreSQL + Prisma 7, Redis/BullMQ previstos. Repositorio: monorepo pnpm + Turborepo (`apps/api`, `apps/web`; `packages/config|contracts|database|eslint-config`).

**Estado real:** la **Fase 1 (fundación + identidad multi-tenant con onboarding y gestión de tenants/usuarios) está implementada, verificada y documentada** (checkpoints M-1…M-5), con F2-1/F2-2 (email real Resend + recuperación de contraseña), **F2-3 (canal de WhatsApp: webhook firmado + idempotencia + BullMQ/Redis) y F2-4 (conversaciones y mensajes persistidos por el worker, con inbox de lectura + envío manual `POST /v1/conversations/:id/messages`) cerrados** (checkpoints M-6…M-8, ADR-010), más **M9 (Embedded Signup OAuth + envío real vía `MetaCloudProvider` + cifrado `access_token` AES-256-GCM con `CryptoService`, ADR-012)** y **F3-3a (proveedor de IA `LlmProvider` con driver OpenRouter, checkpoint M10, ADR-011)**. **F3-3b motor de conversación existe como mínimo funcional cableado solo en worker**: `WhatsappEventsWorker` persiste inbound y encola `llm-jobs` (`requestId=wa:<messageId>`), `LlmJobsWorker` → `ConversationEngineService.respond()` (prompt últimos 50 mensajes, hasta 5 iteraciones de tools, `ToolCatalog` hoy vacío, `llm_runs` con dedup por `requestId`, skip si `status!=BOT_ACTIVE`, envío OUTBOUND vía proveedor + `recordOutboundMessage`). Sin tests propios del engine. La web es solo un panel de estado. **No existe aún** ventas, agendamiento ni dashboard de negocio.

---

## 2. Objetivo del sistema

Producto definido en el contexto de diseño original (§22 preservado en `docs/legacy/`): la IA **no modifica la BD directamente**; toda operación pasa por Tools/Application Services. Será multi-tenant desde el día 1, con aislamiento por `tenant_id` y roles jerárquicos. Flujos objetivo según `PROJECT_CONTEXT.MD` original:
- Modo Ventas: catálogo → precio/stock → cotización → pedido (flujo §5 de la versión original).
- Modo Agendamiento: disponibilidad (**negociada por la app, no por el LLM**) → HOLD → confirmación → reserva, con protección de concurrencia (`SELECT … FOR UPDATE` / exclusión).

**Meta de esta etapa:** backbone de identidad que sirva a cualquier feature futura (cada request resuelve principal y tenant desde BD).

---

## 3. Estado actual

| Área | Estado |
|---|---|
| Monorepo/CI/scaffold | ✅ Completado (pnpm 12.6.0, Turborepo, GitHub Actions, Docker compose PG17+Redis7) |
| Schema + migraciones | ✅ Completado (historial versionado; ver §10) |
| Auth (registro/login/refresh rotation/… ) | ✅ Completado e integrado end-to-end (unit/integration/e2e verdes) |
| Onboarding (invitaciones + email verify/resend) | ✅ Completado; **email por mock por defecto** (`EMAIL_DRIVER=mock`), con adaptador real `ResendEmailAdapter` ya disponible (`EMAIL_DRIVER=resend`, ADR-009) |
| Tenants/usuarios (current, list, update) | ✅ Completado; invariante de "último OWNER" protegido con `FOR UPDATE` |
| Errores canónicos / logging / filtros / rate limiting | ✅ Completado |
| Web (Next.js) | ⚠️ Parcial: solo status panel + `/api/health`; **no consume auth ni gestiona nada** |
| Redis | ✅ **Consumida**: colas `whatsapp-events` + `llm-jobs` (BullMQ) + probe de readiness (Q4) |
| WhatsApp (canal entrante + envío) | ✅ Completado (webhook firmado+idempotente + cola + worker que persiste mensajes — ADR-010; **envío real vía `MetaCloudProvider` + Embedded Signup OAuth + cifrado `access_token` — M9/ADR-012**) |
| Conversaciones y mensajes | ✅ Completado (el worker persiste el inbound de forma idempotente; `GET /conversations`, `GET /conversations/:id/messages` y `POST /conversations/:id/messages` OUTBOUND manual; máquina de estados pura sin endpoints de transición) |
| Proveedor de IA | ✅ Completado (puerto `LlmProvider` + driver OpenRouter; `mock` bloqueado en producción — ADR-011). **Consumido solo por el motor mínimo del worker (F3-3b parcial)** |
| Motor de conversación | ⚠️ Parcial: `ConversationEngineService.respond()` + `LlmJobsWorker` + `llm_runs` operativos en worker; `ToolCatalog` vacío (sin tools de negocio), sin tests propios |
| Ventas / agendamiento / dashboard | ❌ No implementado |
| Recuperación de contraseña | ✅ Completado (forgot/reset, token 1-uso 15 min, ADR-009) |
| Proveedor real de email | ✅ Completado (Resend; `mock` bloqueado en producción) |

Verificación (evidencia fresca del día): unit **230** API + 34 config + 11 contracts, **integración 52/52**, **e2e 106/106**, `db:check` OK, `pnpm verify` root **exit 0** (fuente: `fases/M8-fase-2-conversaciones-mensajes.md`). Dev servers en pausa el 03/10 para poder correr el build de `verify` (un `next dev` activo bloquea `apps/web/.next` con EPERM bajo OneDrive); relanzar con `pnpm dev`. Actualización F2-4: `fases/M8-fase-2-conversaciones-mensajes.md`; canal en `docs/architecture/whatsapp.md` + `docs/api/webhooks.md` + `docs/api/conversations.md`.

---

## 4. Estado final esperado

Derivado de documentación y configuración existentes (sin inventar features):

- **Backbone:** hereda lo de Fase 1 sin reescribirlo (auth+identidad multi-tenant+invitaciones). Modular monolith con Workers como procesos separados del mismo código (`docs/adr/001`).
- **Canal:** integración Meta WhatsApp Cloud API con Embedded Signup **implementado (M9/ADR-012)**: `GET /v1/whatsapp/accounts/embedded-signup/url` (OWNER, `state` JWT 10 min) + `GET /v1/whatsapp/accounts/embedded-signup/callback` público (HTML + `postMessage`, intercambio `code→token` 60d vía `MetaOAuthClient` Graph v21); **webhook validado+idempotente operativo** (UNIQUE `provider_event_id` + dedup + cola BullMQ → HTTP 200, worker que persiste mensajes — ADR-010, `docs/architecture/whatsapp.md`), mensajes con `provider_message_id` (F2-4); **envío real** `POST /v1/conversations/:id/messages` vía `MetaCloudProvider.sendTextMessage` + `recordOutboundMessage`; `access_token` cifrado at-rest (`accessTokenEncrypted:Json {iv,ciphertext,tag}` AES-256-GCM, `CryptoService` en `packages/config`, `ENCRYPTION_KEY` obligatoria si `META_DRIVER=real`).
- **Agente:** abstracción `LlmProvider` (**OpenRouter**, no OpenAI/Anthropic directos — ADR-011) + **motor mínimo `ConversationEngineService.respond()` solo en worker** (prompt últimos 50 mensajes, `MAX_TOOL_ITERATIONS=5`, `ToolCatalog` vacío + `ToolExecutor`, `llm_runs` con dedup `requestId` UNIQUE y skip si `status!=BOT_ACTIVE`); conversaciones con estados `BOT_ACTIVE/HUMAN_REQUESTED/HUMAN_ACTIVE/CLOSED`, transferencia a humano pendiente (F6-3); **el LLM nunca es la fuente de verdad** ni toca la BD directamente.
- **Dashboard:** Inbox, Clientes, Productos, Pedidos, Agenda, Servicios/Servicios, WhatsApp, Configuración IA, Usuarios, Cuenta (web consumiendo la API v1).
- **Datos:** mismas tablas de Fase 1 + tablas tenant-scoped de negocio (conversaciones, mensajes, productos, pedidos, servicios, recursos, citas, config IA), siempre con `tenant_id` y aisladas.
- **Calidad/ops:** RLS como segunda capa (ADR-006), **jobs BullMQ/Redis (cola `whatsapp-events`, worker con lógica de negocio desde M8)**, `pino` o equivalente, coverage con umbrales, **health con dependencias PG+Redis (Q4 cerrado)**, despliegue en Cloudflare/entorno objetivo con migraciones en CD.

> No es requisito implementar todas las features del roadmap original en esta iteración; **el objetivo documental es que cada feature que se construya encaje en esta arquitectura** (ver §24).

---

## 5. Stack tecnológico

| Área | Tecnología | Evidencia |
|---|---|---|
| Runtime | Node **>=24** (engines), `pnpm@12.6.0` (Corepack) | `package.json:6-9` |
| Monorepo | Turborepo 2.x (`turbo.json`), workspace pnpm | `turbo.json`, `pnpm-workspace.yaml` |
| API | NestJS **12** (Express@5), TypeScript strict, `jose` JWT, `argon2`, `class-validator`/`class-transformer`, `@nestjs/swagger`, `@nestjs/throttler` | `apps/api/package.json` |
| Web | Next.js **16.3.6**, React 19, Tailwind v4 (CSS-first) | `apps/web/package.json`, `apps/web/app/globals.css` |
| ORM/DB | Prisma **7.10.0** con `@prisma/adapter-pg` (driver), PostgreSQL 17 local / 16 en CI | `packages/database/package.json`, `ci.yml` |
| Testing | Vitest 5 (unit + integration + e2e con supertest) | `apps/api/vitest.config.*`, `vitest.config.mts` en contracts |
| Lint | ESLint flat compartido (`base`/`nestjs`/… en `packages/eslint-config`) | `packages/eslint-config/base.js` |
| Infra | Docker Compose (`postgres:17-alpine`, `redis:7-alpine`) | `infra/docker/docker-compose.yml` |
| Colas | **BullMQ 5 + ioredis** (cola `whatsapp-events`) | `apps/api/src/infrastructure/queues/*`, `worker/main.ts` |
| CI | GitHub Actions (`on push/PR main`), servicio `postgres:16-alpine` | `.github/workflows/ci.yml` |

**Runtimes en uso:** el primer consumidor real de Redis es la **cola de WhatsApp (BullMQ, M7)** y
la sonda de readiness (`RedisDependencyProbe`); el worker de procesamiento es un proceso separado
(`pnpm --filter @negocia/api start:worker`).

---

## 6. Arquitectura

```
┌────────────────────────────────────────────────────────┐
│ Infra (Docker Compose)                                 │
│  PostgreSQL 17 (negocia-postgres) · Redis 7 (cola)     │
└───────────────┬──────────────────────────┬─────────────┘
                │ Prisma (adapter-pg)       │ ioredis (BullMQ)
                ▼                           ▼
┌────────────────────────────────────────────────────────┐
│ apps/api (NestJS modular monolith)                     │
│                                                        │
│  Presentation  controllers (auth, invitations,         │
│                email-verification, tenants, me,        │
│                health, whatsapp/webhook,              │
│                whatsapp/accounts (+embedded-signup),   │
│                conversations) + DTOs + Swagger         │
│  Application   auth.service, session.service,          │
│                invitations, email-verification,        │
│                tenant(s).service, health.service,      │
│                whatsapp-webhook/accounts/embedded-     │
│                signup.service, conversations.service,  │
│                conversation-engine.service (+prompt,    │
│                tool-executor)                          │
│  Domain        identity, roles, slug, email,           │
│                password-policy, plans, session,        │
│                whatsapp (records/drafts),              │
│                conversations (entities/state-machine/ │
│                meta-mapper), llm (entities/tool-       │
│                catalog/tool-results),                 │
│                errors (ApiError) · Ports               │
│  Infrastructure prisma.repository.* (incl. whatsapp,   │
│                conversation, llm-run), argon2, jose,   │
│                meta-webhook-signature, meta-cloud-     │
│                provider, meta-oauth, mock-whatsapp,    │
│                llm.openrouter/mock, queues/* (whatsapp│
│                -event-queue + llm-job-queue), workers/*│
│                (whatsapp-events + llm-jobs), probes     │
│                (prisma/redis), email-sender.*, crypto  │
│                                                        │
│  Cross-cutting:  Guards APP_GUARD (Throttler→Jwt→      │
│   TenantContext→Roles) + TenantContextInterceptor      │
│   (AsyncLocalStorage) · AllExceptionsFilter ·          │
│   CorrelationId middleware · StructuredLogger         │
└───────────────┬──────────────────────────┬─────────────┘
                │ HTTP                     │ jobs (whatsapp-events c5
                ▼                          ▼  + llm-jobs c2)
    apps/web (estado)              worker/main.ts (WorkerModule
                                   separado: whatsapp-worker
                                   ingestInbound→markProcessed
                                   +enqueue llm-jobs → llm-worker
                                   engine.respond→OUTBOUND+llm_runs)
```

- **Patrón:** modular monolith con capas Presentation→Application→Domain→Infrastructure (`PROJECT_CONTEXT.MD` original §7, `docs/architecture/overview.md`). Infraestructura solo vía puertos (`domain/ports/*`, tokens en `common/di-tokens.ts`).
- **Multi-tenancy:** shared DB + shared schema; `tenant_id` NOT NULL en los tenant-scoped; contexto por request construido desde BD (no desde claims); RLS pospuesto como segunda capa (ADR-006).
- **Flujo de datos (HTTP):** middleware correlation → Guards (`@Public` saltea auth; verificación JWT → releer membresía/tenant/rol de BD vía `TenantContextGuard` → RolesGuard) → interceptor abre ALS con `TenantContext` → handler con válidación (ValidationPipe global) → AppError filtrado → envelope `ApiError`.

---

## 7. Estructura del proyecto

```
negocIA/
├── apps/
│   ├── api/                  # NestJS v1; módulos auth, invitations, email-verification, tenants, me, health, whatsapp, conversations, conversation-engine (+ worker/main.ts + worker.module.ts)
│   │   ├── src/common/       # guards, interceptor, filters, correlation, logger, di-tokens, swagger
│   │   ├── src/domain/       # identity, errors, plans, session, whatsapp, conversations, llm, ports (+ tenant-context)
│   │   ├── src/infrastructure/# argon2, jose, sha256, crypto (vía @negocia/config), prisma repos (incl. conversation, llm-run), prisma.service, probes, queues (whatsapp-event + llm-job), workers (whatsapp-events + llm-jobs), whatsapp (meta-cloud, meta-oauth, mock), llm (mock/openrouter), email (mock/resend)
│   │   ├── src/modules/      # auth, invitations, tenants, health, whatsapp (+embedded-signup), conversations, conversation-engine (presentation/application)
│   │   ├── src/testing/      # fakes in-memory (unit)
│   │   └── test/             # *.integration.spec.ts · *.e2e-spec.ts (BD real/HTTP)
│   └── web/                  # Next.js App Router (layout, page estado, components/api-status)
├── packages/
│   ├── config/               # validateEnv + resolveEnvPath/findEnvFile + CryptoService AES-256-GCM (con tests api-environment.spec.ts)
│   ├── contracts/            # tipos de wire + API_ERROR_CODES (incl. embedded_signup_*) + vocabulario identity (spec de paridad)
│   ├── database/             # Prisma 7: schema 12 modelos, 7 migraciones, factory PrismaClient (+generated)
│   └── eslint-config/        # ESLint flat compartido
├── infra/docker/             # docker-compose (postgres, redis)
├── .github/workflows/ci.yml
├── docs/                     # arquitectura, adr (001-012), database, api, security, infra, estado (ver docs/README.md)
├── fases/                    # bitácora M1…M10 (+ README)
├── .env(.example) ─ turbo.json ─ pnpm-workspace.yaml ─ package.json
```

**Reglas de dependencia** (`docs/architecture/dependency-rules.md`, ADR-003): web → solo `contracts, config, eslint-config` (nunca `database`); api → `database, contracts, config, eslint-config`; config → eslint-config; contracts/config/database sin deps circulares; infraestructura solo vía puertos; **nunca son permitidas** dependencias de web a database ni lógica de negocio en controllers.

---

## 8. Componentes principales

| Componente | Responsabilidad | Archivo(s) |
|---|---|---|
| `AuthService` | register/login/refresh/logout/revoke-all/switch-tenant/me | `modules/auth/application/auth.service.ts` |
| `SessionService` | issue/rotate/revoke family/revoke all (rotación atómica) | `modules/auth/application/session.service.ts` |
| `AuthConfigService` | TTLs/issuer/audience/argonne desde `@negocia/config` | `modules/auth/application/auth-config.service.ts` |
| Guards | Throttler → JwtAuthGuard → TenantContextGuard → RolesGuard | `common/guards/*` |
| `TenantContextInterceptor` | abre `AsyncLocalStorage` con el contexto ya resuelto | `common/tenant-context/tenant-context.interceptor.ts` |
| `AllExceptionsFilter` | `ApiError{code,message,details?,requestId?}`, sin stacks al cliente | `common/filters/all-exceptions.filter.ts` |
| Repos Prisma | puertos (user, membership, tenant, invitation, refresh-token, verification-token, password-reset-token, whatsapp-account/event, conversation, llm-run) | `infrastructure/database/repositories/prisma-*.repository.ts` |
| `UnitOfWork` | transacciones (`$transaction`) usadas en register/accept/rotate/update user | `infrastructure/database/unit-of-work.prisma.ts` |
| `LimitsService` + `PLAN_CATALOG` | límites del plan (BASIC 2/PRO 10/PREMIUM 50 users…) | `domain/plans/*` |
| `refresh-session.{classifyRefreshLookup,computeTokenExpiry}` | reglas puras de sesión | `domain/session/refresh-session.ts` |
| `Swagger setup` | liga OpenAPI en `/api/docs` (+json), bearer | `common/swagger/swagger.setup.ts` |
| `WhatsAppWebhookService` + `WhatsappAccountsService` + `EmbeddedSignupService` | ingest idempotente + alta manual + OAuth (state JWT 10 min, code→token 60d, `MetaOAuthClient` Graph v21) | `modules/whatsapp/application/*`, `infrastructure/whatsapp/meta-oauth.ts` |
| `MetaCloudProvider` / `MockWhatsAppProvider` | envío real `POST {graph}/v21.0/{phoneNumberId}/messages` vs stub `wamid.mock-*` (selector `META_DRIVER`) | `infrastructure/whatsapp/meta-cloud-provider.ts`, `mock-whatsapp-provider.ts`, `whatsapp-provider.factory.ts` |
| `CryptoService` | AES-256-GCM `encrypt/decrypt({iv,ciphertext,tag})`; único uso: `accessTokenEncrypted` | `packages/config/src/crypto.ts`, `prisma-whatsapp-account.repository.ts:85,106` |
| `ConversationsService` | `ingestInbound`/`listByTenant`/`listMessages`/`sendMessage` (Meta primero, luego `recordOutboundMessage`; 404 cross-tenant, 502 si Meta rechaza) | `modules/conversations/application/conversations.service.ts` |
| `ConversationEngineService` + `ToolExecutor` + `prompt.buildPrompt` | `respond({tenantId,conversationId,inboundMessageId,requestId})`: dedup `llm_runs.requestId`, skip si no `BOT_ACTIVE`, historial 50, loop 5 tools (`ToolCatalog` hoy vacío), `recordOutbound` pending→send→`recordOutbound` real, `markSucceeded/Failed/Skipped` | `modules/conversation-engine/application/*`, `domain/llm/tool-catalog.ts` |
| `WhatsappEventsWorker` (c5) + `LlmJobsWorker` (c2) + colas | `whatsapp-events`: `findByProviderEventId`→`ingestInbound`→enqueue `llm-jobs` por mensaje insertado→`markProcessed`; `llm-jobs`: `parseLlmJob`→`engine.respond` | `infrastructure/workers/*.ts`, `infrastructure/queues/*`, `worker.module.ts`, `worker/main.ts` |

---

## 9. Flujos principales

### 9.1 Registro → verificación → invitación → aceptación
```
POST /v1/auth/register  → tx(user+tenant+membership OWNER) → issue(session)
GET  /v1/auth/email-verification/resend (token por email — enviado por Mock)
POST /v1/auth/email-verification/verify (token 1-uso)  → emailVerifiedAt
ADMIN: POST /v1/invitations {email, role ADMIN|AGENT} → token por email, exp 48h
        POST /v1/invitations/accept {token} → tx(revalida max_users) → membership + sesión (nuevo tenant)
```
### 9.2 Login → refresh (rotación) → reuse
```
POST /v1/auth/login  → valida Argon2id → issue (raíz de familia, session_id=id)
POST /v1/auth/refresh → tx(crear sucesor -> revokeIfActive(predecesor)) → si ya rotado: rollback + RefreshAlreadyRotatedError → auth.service detecta reuse → revokeFamily → 401 reuse_detected
POST /v1/auth/logout → revoca familia (`jti` del access token)
POST /v1/auth/revoke-all → revoca todas las familias del user
```
### 9.3 Cambio de tenant y contexto
```
POST /v1/auth/switch-tenant {tenantId} → verifica membresía activa en BD → emite familia nueva con session.tenant_id = destino
GET /v1/me → user + currentTenant + membership + memberships[] (todo desde BD)
```
### 9.4 Gestión de usuarios del tenant (¿) — rol jerárquico
```
PATCH /v1/tenants/:tenantId/users/:userId {role|status}
  → TenantsController.valida :tenantId == contexto (si no → 404)
  → TenantUsersService: reglas jerárquicas (ADMIN no toca OWNER)
  → si baja el último OWNER activo → lockActiveOwners(... FOR UPDATE) → reconteo → 409
```

---

## 10. Modelo de datos (PostgreSQL, Prisma 7)

Fuente: `packages/database/prisma/schema.prisma` (311 líneas, 12 modelos) + migraciones del historial (`20260924012558_identity_core`, `20260929210324_refresh_token_session_id`, `20261003000000_password_reset_tokens`, `20261003192535_whatsapp_webhook_channel`, `20261003233113_add_encrypted_access_token`, `20261004120000_conversations_messages`, `20261005130000_llm_runs`).

**Entidades (12 tablas):**

| Entidad | Scope | Relaciones / claves | Notas |
|---|---|---|---|
| `tenants` | Global | users vía memberships; invitations; whatsapp_accounts/events; conversations/messages/llm_runs | `slug` unique; `plan`/`status` text+CHECK |
| `users` | Global | memberships, refresh_tokens, verification_tokens, reset tokens, invites creadas/aceptadas | email unique + índice `lower(email)` |
| `memberships` | Tenant | user CASCADE, tenant RESTRICT; `@@unique([tenantId,userId])` | `role`/`status` text+CHECK |
| `refresh_tokens` | System | user CASCADE; `replaced_by_token_id` self SetNull | `session_id`+`tenant_id` NOT NULL; token_hash unique; índices parciales activos |
| `invitations` | Tenant | tenant CASCADE, invited_by RESTRICT, accepted_by SetNull | partial unique PENDING por (tenant,email) |
| `verification_tokens` | System | user CASCADE | 1-uso, expires |
| `password_reset_tokens` | System | user CASCADE | 1-uso, 15 min, UNIQUE token_hash (F2-2) |
| `whatsapp_accounts` | Tenant | tenant RESTRICT; UNIQUE `(tenant_id, waba_id)` y `(tenant_id, phone_number_id)` (F2-3) | `accessTokenEncrypted:Json {iv,ciphertext,tag}` AES-256-GCM (M9, migración `add_encrypted_access_token`); nunca se expone en DTOs |
| `whatsapp_events` | Global (idempotencia) | account/tenant SetNull | UNIQUE global `provider_event_id`; índice `(status, created_at)` (F2-3/ADR-010) |
| `conversations` | Tenant | tenant/account RESTRICT; `@@unique([tenantId,accountId,customerWaId])` | `status=BOT_ACTIVE` por defecto; `last_message_at`; índice `(tenant_id,status,last_message_at)` (F2-4) |
| `messages` | Tenant | conversation CASCADE; UNIQUE global `provider_message_id` (`wamid`) | `direction INBOUND/OUTBOUND`, `delivery_status` desde `statuses[]`; índice `(conversation_id,created_at)` (F2-4/M9) |
| `llm_runs` | Tenant | conversation CASCADE; inbound RESTRICT / outbound SetNull; UNIQUE `request_id` | `status RUNNING/SUCCEEDED/FAILED/SKIPPED`, `driver/requested_model/resolved_model`, tokens + `tool_calls/attempts/latency_ms/error_*` (F3-3b; dedup `wa:<messageId>`) |

**Invariantes SQL** (migración `identity_core`):
- `tenants.plan IN ('BASIC','PRO','PREMIUM')`, `tenants.status IN ('ACTIVE','SUSPENDED','CLOSED')`
- `users.status IN ('ACTIVE','DISABLED')`
- `memberships.role IN ('OWNER','ADMIN','AGENT')`, `memberships.status IN ('ACTIVE','INACTIVE')`
- `invitations.role/status IN (…)`, paridad `accepted_at IS NULL = accepted_by IS NULL`
- unique `lower(email)` (fallback de la elección de no usar citext)

**ERD:**

```mermaid
erDiagram
  tenants ||--o{ memberships : "owners/members"
  users ||--o{ memberships : ""
  users ||--o{ invitations : "createdBy"
  tenants ||--o{ invitations : ""
  users ||--o{ verification_tokens : ""
  users ||--o{ refresh_tokens : ""
  refresh_tokens ||--o| refresh_tokens : "replacedBy (familia)"

  tenants { uuid id PK; text slug UK; text name; text plan; text status; timestamptz created_at; timestamptz updated_at }
  users { uuid id PK; text email UK; text password_hash; text name; text status; timestamptz email_verified_at; timestamptz created_at }
  memberships { uuid id PK; uuid tenant_id FK; uuid user_id FK; text role; text status; timestamptz created_at }
  refresh_tokens { uuid id PK; uuid user_id FK; uuid session_id; uuid tenant_id; text token_hash UK; timestamptz expires_at; timestamptz revoked_at; uuid replaced_by_token_id UK }
  invitations { uuid id PK; uuid tenant_id FK; text email; text role; uuid invited_by FK; uuid accepted_by FK; text token_hash UK; text status; timestamptz expires_at }
  verification_tokens { uuid id PK; uuid user_id FK; text token_hash UK; timestamptz expires_at; timestamptz used_at }
  password_reset_tokens { uuid id PK; uuid user_id FK; text token_hash UK; timestamptz expires_at; timestamptz used_at }
  whatsapp_accounts { uuid id PK; uuid tenant_id FK; text waba_id; text phone_number_id; text display_phone; jsonb access_token_encrypted; text status; timestamptz created_at; UNIQUE(tenant_id, waba_id); UNIQUE(tenant_id, phone_number_id) }
  whatsapp_events { uuid id PK; text provider_event_id UK; uuid tenant_id FK; uuid account_id FK; text event_type; jsonb payload; text status; timestamptz created_at; timestamptz processed_at }
  conversations { uuid id PK; uuid tenant_id FK; uuid account_id FK; text customer_wa_id; text customer_name; text status; timestamptz last_message_at; UNIQUE(tenant_id, account_id, customer_wa_id) }
  messages { uuid id PK; uuid tenant_id FK; uuid conversation_id FK; text provider_message_id UK; text direction; text type; text content; text delivery_status; jsonb metadata }
  llm_runs { uuid id PK; uuid tenant_id FK; uuid conversation_id FK; uuid inbound_message_id FK; uuid outbound_message_id FK; text request_id UK; text status; text driver; text requested_model; int prompt_tokens; int completion_tokens; int total_tokens }
```

**Flujo de persistencia:** `createPrismaClient()` en `packages/database/src/index.ts` (singleton con guarda NODE_ENV, adapter `PrismaPg`) → injectado como `DATABASE` via `DatabaseModule`/`prisma.service.ts` → repos Prisma por puerto; transacciones vía `UnitOfWork`. Migraciones **solo** vía `prisma migrate deploy` en consignación (`pnpm prisma:deploy`); no hay seeds (tests crean sus datos con factories/`fakes.ts`).

---

## 11. APIs

Prefijo global `api`, versionado URI **v1 por defecto**; health neutral. Swagger en `/api/docs`. Todas con `ApiError` como formato de error y `X-Request-Id`.

| Método | Ruta | Propósito | Auth | Thin | Estado |
|---|---|---|---|---|---|
| POST | `/api/v1/auth/register` | Crear cuenta+tenant+OWNER; sesión | `@Public` (5/10min) | 201 | ✅ |
| POST | `/api/v1/auth/login` | Sesión (anti-enumeración) | `@Public` (10/5min) | 200 | ✅ |
| POST | `/api/v1/auth/refresh` | Rotar sesión | `@Public` (60/5min) | 200 | ✅ |
| POST | `/api/v1/auth/logout` | Revocar familia | Bearer | 204 | ✅ |
| POST | `/api/v1/auth/revoke-all` | Revocar todas | Bearer (10/5min) | 204 | ✅ |
| POST | `/api/v1/auth/switch-tenant` | Cambiar tenant | Bearer (30/5min) | 200 | ✅ |
| GET | `/api/v1/me` | Perfil+membresías | Bearer | 200 | ✅ |
| POST | `/api/v1/invitations` | Invitar (OWNER/ADMIN) | Bearer (30/1h) | 201 | ✅ |
| POST | `/api/v1/invitations/accept` | `@Public` auth-optional→sesión en tenant | Bearer | 200 | ✅ |
| DELETE | `/api/v1/invitations/:id` | Revocar invitación | Bearer OWNER/ADMIN | 204 | ✅ |
| POST | `/api/v1/email-verification/verify` | Confirmar email (1-uso) | Bearer | 200 | ✅ |
| POST | `/api/v1/email-verification/resend` | Reenviar token | Bearer (5/15min) | 200 | ✅ |
| GET | `/api/v1/tenants/current` | Metadatos tenant | Bearer | 200 | ✅ |
| PATCH | `/api/v1/tenants/current` | Edit name/slug (OWNER) | Bearer | 200 | ✅ |
| GET | `/api/v1/tenants/:tenantId/users` | Lista miembros | Bearer (url vs ctx→404) | 200 | ✅ |
| PATCH | `/api/v1/tenants/:tenantId/users/:userId` | Rol/estado (ADMIN) | Bearer | 200 | ✅ |
| GET | `/api/v1/whatsapp/webhook` | Handshake Meta (challenge text/plain) | `@Public` | 200/403 | ✅ |
| POST | `/api/v1/whatsapp/webhook` | Ingestión de eventos (firma HMAC `X-Hub-Signature-256` + dedup + enqueue) | `@Public` (Throttle 600/60s) | 200/401 | ✅ |
| POST | `/api/v1/whatsapp/accounts` | Alta manual de cuenta WABA (OWNER) | Bearer OWNER | 201/409 | ✅ |
| GET | `/api/v1/whatsapp/accounts` | Lista cuentas del tenant (sin accessToken) | Bearer OWNER | 200 | ✅ |
| GET | `/api/v1/whatsapp/accounts/embedded-signup/url` | URL OAuth Meta + `state` JWT 10 min (M9) | Bearer OWNER/ADMIN/AGENT | 200/400 | ✅ |
| GET | `/api/v1/whatsapp/accounts/embedded-signup/callback` | Callback OAuth público (HTML + `postMessage`; M9) | `@Public` | 200 HTML | ✅ |
| GET | `/api/v1/conversations` | Bandeja paginada (`limit/offset/status`) | Bearer AGENT+ | 200 | ✅ |
| GET | `/api/v1/conversations/:id/messages` | Historial cronológico (404 cross-tenant) | Bearer AGENT+ | 200/404 | ✅ |
| POST | `/api/v1/conversations/:id/messages` | Envío manual OUTBOUND `{text 1-4096}` vía proveedor (M9) | Bearer AGENT+ | 201/400/404/502 | ✅ |
| GET | `/api/health` | Liveness (sin deps) | none | 200 | ✅ |
| GET | `/api/health/ready` | Readiness (probes PostgreSQL **+ Redis**) | none | 200/503 | ✅ |

**Errores canónicos** (`packages/contracts/src/errors.ts`): `validation_error, invalid_credentials, invalid_refresh_token, invalid_token, token_expired, reuse_detected, account_disabled, tenant_inactive, membership_inactive, forbidden, not_found, invitation_not_found, user_not_found, email_already_registered, already_member, invitation_pending, email_in_use, conflict, rate_limited, webhook_verification_failed, external_provider_error, llm_error, database_error, internal_server_error` + 7 `embedded_signup_*` (`state_mismatch, code_exchange, missing_token, account_conflict, validation, oauth, invalid_request`; M9; spec de paridad `identity-vocabulary.spec.ts:119-125` con `domain/errors`).

---

## 12. Autenticación y autorización

**Diseño** (`docs/architecture/authentication.md`, ADR-005): auth autogestionada; NUNCA delegar a Supabase/Auth0.

- **Access token:** JWT HS256 corto (15 min por defecto), claims mínimos (`sub`, `jti`=session_id, `tenant_id`, exp), secret mínimo 32 bytes.
- **Refresh token:** opaco, guardado como hash SHA-256; **rotación con transacción**: se inserta el sucesor, luego `revokeIfActive` del predecesor; si la carrera la gana otro proceso → rollback + `RefreshAlreadyRotatedError`; el reuso de un token rotado revoca **toda la familia** (401 `reuse_detected`).
- **Contraseñas:** Argon2id con parámetros OWASP (`APP_ENV` traducido a `ARGON2_MEMORY_COST=19456`, time 2, parallelism 1; validación `>=8192` en `validateEnv`).
- **Principal:** se **relee de BD en cada request** (TenantContextGuard) → no se fía de claims para autorización; JWT solo prueba quién conoce la firma.
- **Roles:** OWNER > ADMIN > AGENT, releídos como `Membership.status=ACTIVE`; prohibido dejar el tenant sin OWNER activo.
- **Acceso:** guards `APP_GUARD` fail-closed (salvo `@Public()`), CORS desde `CORS_ORIGINS`, rate limiting global 100 req/60s + per-ruta, `X-Request-Id`.

Flujo JWT→Principal: [`jwt-auth.guard.ts:32-58` (`verify`) → `tenant-context.guard.ts` busca `user+tenant+membership` en BD] → `roles.guard.ts` valida `@Roles` declarados.

---

## 13. Integraciones externas

| Servicio | Uso real | Config | Estado |
|---|---|---|---|
| PostgreSQL | Fuente de verdad (relacional) | `DATABASE_URL`, docker `negocia-postgres` | ✅ activa |
| Redis | Cola `whatsapp-events` (BullMQ) + probe readiness | Docker `negocia-redis`, `REDIS_URL` | ✅ activa (M7) |
| Email (Mock/Resend) | `MockEmailAdapter` buffer (dev/test) / `ResendEmailAdapter` real (prod; `mock` bloqueado en prod) | `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM*`, `APP_BASE_URL` | ✅ ambas (M6/ADR-009) |
| Meta WhatsApp Cloud API | Canal entrante (webhook verificado + idempotente) **+ envío real `MetaCloudProvider` + Embedded Signup `MetaOAuthClient`** | `META_DRIVER`, `META_WEBHOOK_*`, `META_APP_ID/SECRET`, `META_EMBEDDED_SIGNUP_REDIRECT_URI`, `ENCRYPTION_KEY` | ✅ entrante (M7) + M9 (ADR-012) |
| LLM (OpenRouter) | Puerto + `Mock/OpenRouter` adapters; **consumido por motor mínimo del worker** | `LLM_DRIVER`, `OPENROUTER_API_KEY`, `LLM_MODEL` (`:free`), `LLM_BASE_URL/TIMEOUT/APP_URL/TITLE` | ✅ F3-3a (ADR-011) + F3-3b parcial (sin tools de negocio, sin tests engine) |
| Shut-in: Argon2/jose | internos crypto | deps API | ✅ |

---

## 14. Configuración

- **Entorno:** un único `.env` en la raíz (copiar `.env.example`); lo cargan API (vía `@negocia/config` `resolveEnvPath()`), Prisma (`prisma.config.ts`), Next (`next.config.ts`).
- **API:** Nestjs ConfigModule `isGlobal` + `cache` + `validate: validateEnv` (`app.module.ts:37-42`). `resolveEnvPath()` usa `INIT_CWD ?? cwd` y sube hasta 6 niveles buscando `.env` (`packages/config/src/api-environment.ts:224-243`) — **esto resolvió el bug de dev** (INIT_CWD indefinido en el árbol pnpm→turbo→nest).
- **Base:** Docker Compose en `infra/docker`; healthchecks `pg_isready`/`redis-cli ping`; volumes con nombre.
- **CI:** `.github/workflows/ci.yml` → `pnpm verify` con PostgreSQL 16 (servicio) y `TEST_DATABASE_URL` a schema `negocia_test`.

**Comandos** (`package.json`): `pnpm dev` (turbo), `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm verify` (=lint+typecheck+build+test+integration+e2e+db:check), `pnpm db:up/down/logs/ps/check`, `pnpm prisma:generate/validate/migrate/deploy/push/studio`.

---

## 15. Variables de entorno

Fuente: `.env.example` (raíz). `validateEnv` en `packages/config/src/api-environment.ts`.

| Variable | Propósito | Obligatoria | Lugar de uso |
|---|---|---|---|
| `NODE_ENV` | development/test/production | no (default development) | validateEnv, todos |
| `API_HOST` | bind host (default `0.0.0.0`) | no | `main.ts` |
| `API_PORT` | puerto (1-65535; default 4000) | no | `main.ts` |
| `LOG_LEVEL` | fatal…debug (default info) | no | `structured-logger.ts` |
| `CORS_ORIGINS` | origenes CORS separados por `,` | no (vacío = error) | `main.ts` |
| `DATABASE_URL` | DSN PostgreSQL | **sí*** | `packages/database` factory |
| `JWT_SECRET` | secreto HS256 (>=32 bytes) | **sí en todos los entornos** | `jwt-access-token-issuer.ts` |
| `JWT_ISSUER` / `JWT_AUDIENCE` | claims iss/aud | no (defaults) | issuer |
| `JWT_ACCESS_TTL_SECONDS` | default 900 (15m) | no | AuthConfigService |
| `JWT_REFRESH_TTL_SECONDS` | default 2592000 (30d) | no (debe > access) | AuthConfigService |
| `ARGON2_MEMORY_COST` (default 19456 ≥8192), `ARGON2_TIME_COST` (2), `ARGON2_PARALLELISM` (1) | parámetros Argon2id | no | argon2 adapter |
| `POSTGRES_*`,`POSTGRES_PORT` | credenciales compose | no (defaults negocia) | docker-compose |
| `REDIS_URL` | DSN Redis (colas `whatsapp-events` + `llm-jobs` + probe readiness) | **sí*** | `whatsapp-event-queue`, `llm-job-queue`, `redis-dependency-probe` |
| `META_DRIVER` (`mock`\|`real`, default mock) | driver del canal WhatsApp (mock bloqueado en `production`) | **sí*** | `api-environment`, webhook, `whatsapp-provider.factory` |
| `META_WEBHOOK_VERIFY_TOKEN` / `META_WEBHOOK_APP_SECRET` | verify token + secreto HMAC del webhook (mins 8/16) | **sí*** | `whatsapp-webhook.controller`, `meta-webhook-signature` |
| `META_APP_ID` / `META_APP_SECRET` | credenciales app Meta para Embedded Signup (M9) | sí si `real` + signup | `meta-oauth.ts`, `embedded-signup.service.ts` |
| `META_EMBEDDED_SIGNUP_REDIRECT_URI` | callback registrado en Meta (M9) | sí si signup | `embedded-signup.service.ts` |
| `ENCRYPTION_KEY` | 32 bytes base64 AES-256-GCM (cifrado `access_token`) | **sí si `META_DRIVER=real`** | `packages/config/src/crypto.ts`, `prisma-whatsapp-account.repository` |
| `EMAIL_DRIVER` (`mock`\|`resend`) + `RESEND_API_KEY` + `EMAIL_FROM/EMAIL_FROM_NAME` + `APP_BASE_URL` | proveedor email + remitente + base enlaces | `RESEND_API_KEY` sí si `resend`; `mock` bloqueado en prod | `email.module.ts`, `email-sender.resend.ts` |
| `LLM_DRIVER` (`mock`\|`openrouter`) + `OPENROUTER_API_KEY` + `LLM_MODEL` (`:free`) + `LLM_BASE_URL/TIMEOUT_MS/APP_URL/APP_TITLE` | proveedor IA (mock bloqueado en prod) | `OPENROUTER_API_KEY` sí si `openrouter` | `llm.module.ts`, `llm.openrouter.ts` |
| `NEXT_PUBLIC_API_URL` (web) | base de la API para el navegador (default `http://localhost:4000/api`) | — | `apps/web` |
| `TEST_DATABASE_URL` | DSN al schema de tests | para tests | vitest/integration/e2e |

> No se documentan valores reales (el `.env` raíz está gitignored). `JWT_SECRET` y `DATABASE_URL` existen en `.env` local.

---

## 16. Testing

**Arquitectura de suites** (`apps/api`):

| Suite | Qué cubre | Archivos | Casos (verify 03/10) | Estado |
|---|---|---|---|---|
| Unit (`*.spec.ts` en `src/`) | dominio (errors, session, plans, auth.service, session.service, mocks, argon2, jose, sha256, guards, logger, tenant-context, health, webhook service, meta-signature) + conversaciones (state-machine, meta-message.mapper, conversations.service) + llm (mock 4 + openrouter 23) + email (mock/resend) | 25 (sin contar contracts/config/database) | **257 API + 44 config + 11 contracts + 7 database** (fuente M10) | ✅ verde |
| Contracts (`identity-vocabulary.spec.ts`) | paridad catálogo errores/vocabulary con migración (incl. 7 `embedded_signup_*` M9) | 1 | +11 | ✅ |
| Integration (`test/*.integration.spec.ts`) | BD real: repos + servicios (auth, invitations, tenants, dependency-probe, whatsapp repos, conversation repo) | 6 | **52** | ✅ |
| E2E (`test/*.e2e-spec.ts`) | HTTP supertest: registro→login→invite→accept→verify→rotate→reuse; tenants; health (PG+Redis); webhook+cuentas; GET conversaciones+mensajes (+ POST OUTBOUND manual M9) | 6 | **106** | ✅ |

- `vitest.config.*` de API configuran unit (BD in-memory fakes) vs integración (real) vs e2e (`TEST_DATABASE_URL`; limpieza schema por test).
- **Sin cobertura numérica configurada** (no hay thresholds ni reporte) → "no determinada".

**Gaps conocidos:** **web sin tests**; sin tests propios de M9 (`EmbeddedSignupService`, `MetaOAuthClient`, e2e callback + `POST /conversations/:id/messages` 404/502/validación — brecha declarada en `fases/M9:71-74`) ni del motor F3-3b (`conversation-engine.service`, `prompt.buildPrompt`, `tool-executor`, `llm-jobs.worker`, enqueue `llm-jobs` desde `whatsapp-events.worker`); no hay test de carrera real de `refresh` contra un segundo proceso (unit lo simula); no hay tests de RLS (no existe), de **concurrencia real de dos webhooks simultáneos** (P2002 simulado en unit + dedup cubierto en integración), de concurrencia de agendamiento (no existe), de fuga de tenant cruzado con 2 tenants reales **borde** (e2e cubre aislamiento en invitaciones/tenants).

---

## 17. Seguridad (análisis; diferenciamos evidencia/riesgo/recomendación)

**Evidencia confirmada en código:**
- Argon2id con parámetros OWASP + validación de mínimo 8192 KiB (`api-environment.ts:151-155`); contraseñas nunca se loguean.
- JWT solo verifica firma; autorización releída de BD por request; `TenantContextGuard` + `RolesGuard`; `assertTenantInUrl` devuelve **404** (no revela) cuando el `:tenantId` no coincide con el contexto (`tenants.controller`).
- Tokens opacos por hash SHA-256 1-uso; rotación/revocación atómica con rollback; expiración 48h invitaciones; límites de plan revalidados en transacción (race-safe).
- Filtro global no expone stacks; `requestId` de correlación; CORS restringido; rate (global+per-ruta); `@SkipThrottle` solo en health; `whitelist+forbidNonWhitelisted`.
- SQL: `$queryRaw` con tag + interpolación parametrizada (`FOR UPDATE`, probes); repositorios vía Prisma.

**Riesgos potenciales (a validar antes de producción):**
- HS256 simétrico: si se filtra `JWT_SECRET` se pueden forjar tokens. Mitigación actual: TTL corto + releer principal en cada request. **Recomendación:** agentes de servicio/almacenamiento seguro y evaluar ES256 + `kid` rotación en despliegue.
- Timing en `login` con email inexistente (distinto de Argon2) — posible enumeración por tiempo. **Recomendación:** hash dummy en la rama de usuario inexistente (verificar/implementar en Fase 6).
- El `.env` raíz concentra secretos; `NODE_ENV` con validez incluida; asegurar que el deploy no firme nada sin `JWT_SECRET` (ya es obligatoria en todos los entornos).

**No aplica hoy:** CSRF (API bearer sin cookies), XSS (web sin inputs), RLS (pospuesta; app-layer es la única barrera actual — se valida por tests de aislamiento e2e).

---

## 18. Problemas conocidos

1. **`INIT_CWD` indefinido en cadenas pnpm→turbo→nest** rompía `resolveEnvPath()` (fallaba `validateEnv` → API sin bootear). **Resuelto** con `findEnvFile()` que sube hasta 6 niveles (`api-environment.ts:229-243`). `prisma.config.ts` y `next.config.ts` usan el mismo helper `INIT_CWD ?? cwd` y son estables porque se invocan desde la raíz.
2. **Origen del desorden documental:** el `README.md` se quedó atrás (dice "Sin autenticación / sin funcionalidades", `README.md:5,136-138`), contradice Fase 1 completada (ver §"Documentación vs implementación").
3. ~~`INVITABLE_ROLES = ["ADMIN","AGENT"]` declarado pero el DTO aceptaba `@IsIn(ROLES)` (incluía OWNER); el límite real era `@Roles(OWNER,ADMIN)` del controller.~~ **Resuelto (30/09):** matriz `canInviteRole` en `domain/identity/roles.ts:44-56`; `OWNER` invita a OWNER/ADMIN/AGENT, `ADMIN` solo a ADMIN/AGENT; 403 `forbidden` si un ADMIN pide OWNER (<del>la constante muerta en el DTO fue eliminada</del>).
4. ~~**Email real inexistente** → onboarding solo verificable con mock.~~ **Resuelto (M6/ADR-009):** `ResendEmailAdapter` + `EMAIL_DRIVER` (`mock` bloqueado en prod).
5. ~~**`schema.md` sin las columnas `session_id`/`tenant_id`** de `refresh_tokens` añadidas en M-4.~~ **Resuelto (F1-C4):** `docs/database/schema.md §6` ya las documenta.
6. **Divergencia PROJECT_CONTEXT ↔ código (M9 + motor):** este documento afirmaba "sin envío/Signup" y "LLM sin consumidor" cuando el código ya trae M9 y motor mínimo F3-3b — **resuelto en esta sincronización** (ver §§1,3,4,6,10,11,13,20,24,30,33).

---

## 19. Deuda técnica

- ~~`packages/config` y `packages/database` sin tests propios (Q1/Q2, §24).~~ → **hecho (03/10):** `api-environment.spec.ts` + `index.spec.ts` + `check-connection.spec.ts`.
- `docs/infrastructure/...` §13.5 desviación Zod→`validateEnv` **ya resuelta** por ADR-009 (norma actualizada); no requiere código.
- ~~`health/ready` no sondea Redis todavía (solo PostgreSQL vía `prisma-dependency-probe`); menor (Q4).~~ → **hecho (03/10):** `DEPENDENCY_PROBES` agrega `RedisDependencyProbe`; `REDIS_URL` obligatoria.
- Worker de WhatsApp **procesa negocio** (`ingestInbound` + `markProcessed` + enqueue `llm-jobs`; ya no es probe); **cifrado at-rest del `access_token` hecho (M9)** — queda rotación 60d (F7-D3); sin job de mantenimiento de `whatsapp_events`/colas (`whatsapp-events`, `llm-jobs`).
- Sin limpieza automática de refresh tokens expirados (jobs previstos con BullMQ en Fase 2).
- No hay `coverage` configurado en Vitest.

---

## 20. Funcionalidades pendientes

Ver `docs/pendiente-fase-2.md`. Resumen:
- **Fase 2:** WhatsApp Cloud API — **canal entrante ✅ (M7)** y **conversaciones/mensajes ✅ (M8, F2-4)** + **Embedded Signup y envío real ✅ (M9/ADR-012)**; queda SDK de Meta/templates; **proveedor LLM ✅ (M10, F3-3a/ADR-011)** + **motor mínimo ✅ parcial (F3-3b: colas `whatsapp-events`+`llm-jobs`, `llm_runs`, `ConversationEngineService`, `ToolCatalog` vacío, sin tools de negocio ni handoff)**; modelo de negocio (productos, pedidos, servicios, citas, clientes); dashboard.
- **Cierre Fase 1:** web consumiendo API (proveedor de email y recuperación de contraseña ya cerrados, ADR-009).
- **Deudas menores:** Q1-Q5 cerrados (Q4 = health Redis en M7), colas BullMQ operativas (`whatsapp-events` + `llm-jobs`); pendiente tests M9 + tests engine, mantenimiento/limpieza de colas y despliegue/CD.

---

## 21. Decisiones técnicas existentes (mantener / revisar)

**Mantener (evidencia en ADRs y código; no romper):**
1. Modular monolith (ADR-001) — no microservicios aún.
2. PostgreSQL como fuente de verdad (ADR-002, ADR-004) — Redis jamás para reservas.
3. Auth propia con rotación + `jti`-familia (ADR-005, SessionService).
4. Enums text+CHECK en migración, no enums nativos (M-1).
5. `validateEnv` SIN Zod (ADR-009); DTOs con class-validator (inputs en api, respuestas en contracts).
6. Port-adapter (PasswordHasher, EmailSender→Mock, TokenHasher→SHA-256, repos→Prisma).
7. `tenant_id` nunca del cliente; contexto desde BD; guards fail-closed; 404 en lugar de 403 para IDs ajenos.
8. Guard chain-fijo + interceptor ALS; RLS como segunda capa progresiva (ADR-006).
9. Planes como `PlanCatalog`/`LimitsService` no JSONB (ADR-007).
10. Monitorización: StructuredLogger + requestId + correlación (`X-Request-Id`).

**Revisar/abierta (en Fase 2-8):**
- HS256 → asimétrico (ES256) + rotación en producción (S3).
- ~~Decisión `INVITABLE_ROLES` (ADMIN→OWNER)~~ → **decidida (30/09): matriz `canInviteRole`; ADMIN no puede invitar OWNER**.
- Alinear `PLAN_CATALOG` (users 2/10/50, msgs 500/10k/100k, productos 10/100/1000) con el plan comercial del diseño original (1/3/5 users, etc.) cuando exista billing.
- ~~Proveedor LLM~~ → **decidido (03/10): OpenRouter** (`LLM_DRIVER=openrouter`, ADR-011). Sigue
  abierto el modo **streaming/memoria** de conversación (este hito solo hace completions
  no-streaming: el consumidor es un worker de cola que persiste la respuesta completa).
- Elegir real-time: Socket.IO vs SSE (abierto, `PROJECT_CONTEXT.MD` original §6).

---

## 22. Restricciones conocidas

- **Node >= 24, pnpm >= 12** (root `engines`, `packageManager`); `packageImportMethod: copy`.
- No introducir dependencias de web → `database`; no importar tipos de cliente Prisma fuera de `apps/api`/`packages/database`.
- No migrar sin `prisma migrate deploy` (nunca editar prod manualmente).
- `JWT_SECRET` siempre requerida (aun en `test`) → los tests llevan su propio secreto vía `TEST_DATABASE_URL`/env en los scripts vitest.
- **No ejecutar `pnpm prisma:push`** sobre la BD de tests/desarrollo sin revisar (statos); preferir migraciones versionadas.
- Caso del puerto: `API_PORT` debe ser entero 1-65535.
- No revelar credenciales; `.env` no se versiona.

---

## 23. Convenciones del proyecto

- pnpm + Turborepo; Turbo tasks `lint/typecheck/test` dependen de `^build`; `dev` no cacheable.
- TypeScript strict; `consistent-type-imports` con inline; vars no usadas ignoradas solo con prefijo `_`; ESLint flat (`base`/`nestjs`).
- Style Nest: módulos de feature → `presentation/` (controllers, DTOs, mappers) + `application/` (services) + `domain/` (domain puro) + `infrastructure/` (adapters/repos). `di-tokens.ts` para tokens de inyección basados en puertos.
- Errores de dominio: subclases de `AppError` con `code` del catálogo de `contracts` (paridad testada).
- Nombres: kebab-case para archivos; snake_case para columnas DB vía `@map`/`@map`; verbs de casos de uso en presentación.
- Valores de test: `vitest` (unit en src, integración/e2e en `test/`), BD real para integración/e2e con schema `negocia_test`.
- Docs: idioma español, `docs/` con índice, artefactos por feature (ADR antes de cambios estructurales), bitácora por fase en `fases/M<n>-slug.md`.

---

## 24. Roadmap de finalización (orden por dependencias, con criterio de aceptación)

> Prioridad técnica: **C** crítica, **A** alta, **M** media, **B** baja. "Estado": pendiente/…/done.

### Fase 1 — Correcciones críticas
- **[F1-C1]** ✅ **Hecho (30/09):** matriz de roles invitables (`canInviteRole` en `domain/identity/roles.ts`). OWNER→{OWNER,ADMIN,AGENT}; ADMIN→{ADMIN,AGENT}; 403 si ADMIN→OWNER. Tests unit (matriz) + e2e actualizados; docs §7.1 y pendiente-fase-2 corregidas. Sin actividad pendiente. — **C**.
- **[F1-C2]** ✅ **Hecho (03/10):** `README.md` alineado con Fase 1 completada (estado actual, árbol `apps/api`, sección Roadmap, referencia `PROJECT_CONTEXT.md` y fila `pnpm verify`). Sin afirmaciones falsas. **C**.
- **[F1-C3]** Decidir números `PLAN_CATALOG` vs diseño original (§27→2/10/50 vs 1/3/5) y fijar en doc único cuando exista billing. Archivos: `domain/plans/plan-catalog.ts`, `docs/pendiente-fase-2.md`. **M**. *(pendiente de decisión comercial)*
- **[F1-C4]** ✅ **Hecho (03/10):** `docs/database/schema.md` §6 con `session_id`/`tenant_id`, `UNIQUE (replaced_by_token_id)`, índices `(session_id)`/`(tenant_id)` y notas de familia. Verificado contra `schema.prisma`. **M**.

### Fase 2 — Funcionalidad faltante (backbone de negocio)
- **[F2-1]** ✅ **Hecho (03/10):** proveedor real de email vía **Resend** (SDK) + `EmailModule` + plantillas text/HTML + guard `EMAIL_DRIVER=mock` en producción. Dep: `resend` (apps/api), ADR-009. **A**. → hito `fases/M6-fase-2-email-reset.md`.
- **[F2-2]** ✅ **Hecho (03/10):** recuperación de contraseña (`forgot-password`/`reset-password`, tabla dedicada `password_reset_tokens`, token 1-uso 15 min, `invalid_token` unificado, revocación de sesiones). Dep: F2-1. **A**. → hito `fases/M6-fase-2-email-reset.md`.
- **[F2-3]** ✅ **Hecho (M7 + M9/ADR-012):** webhook validado por firma (`X-Hub-Signature-256`) + idempotencia (`provider_event_id` UNIQUE) + enqueue BullMQ (`jobId`) + worker separado + alta manual de cuentas (OWNER) **+ Embedded Signup OAuth (`GET .../embedded-signup/url|callback`, `MetaOAuthClient` Graph v21, `state` JWT 10 min) + envío real (`MetaCloudProvider`) + cifrado `access_token` (`CryptoService` AES-256-GCM, `ENCRYPTION_KEY`)**. Queda: rotación 60d, templates, SDK Meta. Dep: F2-1, F1, ADR-010/012. **C**. → hitos `fases/M7-fase-2-whatsapp-canal-entrante.md`, `fases/M9-embedded-signup-envio-real.md`.
- **[F2-4]** ✅ **Hecho (M8):** conversaciones/mensajes — el worker persiste los mensajes entrantes (idempotencia `provider_message_id`, transacción atómica), máquina de estados pura `BOT_ACTIVE→HUMAN_*` (reglas + unit tests; transiciones en la API → F6-3), `GET /v1/conversations`, `GET /v1/conversations/:id/messages` y `POST /v1/conversations/:id/messages` OUTBOUND manual (AGENT+; 404 cross-tenant, 502 si Meta rechaza). Dep: F2-3. **A**. → hito `fases/M8-fase-2-conversaciones-mensajes.md`.

### Fase 3 — Integración
- **[F3-1]** Web consume API: login UI, guard de sesión (cookies HttpOnly + refresh rotation del lado cliente o PKCE), onboarding del tenant, gestión usuarios. Dep: F2-1/F2-2; API ya lista. **A**.
- **[F3-2]** ✅ **Hecho parcial:** `WorkerModule` separado (`worker/main.ts`) con `WhatsappEventsWorker` (concurrency 5: ingestInbound + `markProcessed` + enqueue `llm-jobs`) + `LlmJobsWorker` (concurrency 2: `engine.respond`). Dep: F2-3/F2-4. **A**.
- **[F3-3]** Agente: `LLMProvider` (abstracción) + Tool Calling + transferencia a humano + contexto. Dep: F3-2, F2-4. **C** (core futuro).
  - ✅ **F3-3a hecho (03/10, hito M10):** puerto `LlmProvider` en el dominio + drivers `mock`/`openrouter`
    (`fetch` nativo, sin SDK), selección por `LLM_DRIVER` con `mock` bloqueado en producción, ADR-011.
  - ⚠️ **F3-3b parcial (código sin tests):** `ConversationEngineService.respond()` + `ToolExecutor` + `prompt.buildPrompt` + `ToolCatalog` (vacío, sin tools de negocio) + cola `llm-jobs` + tabla `llm_runs` (dedup `requestId=wa:<messageId>`, `markSucceeded/Failed/Skipped`, skip si no `BOT_ACTIVE`, envío OUTBOUND vía proveedor). Falta: tools de negocio, handoff (F6-3), gasto por tenant, tests (engine/prompt/executor/workers). `AppModule` aún declara el `LlmModule` como "sin consumidor HTTP" (`app.module.ts:56-58`) — el consumo es solo worker.

### Fase 4 — Calidad
- **[F4-Q1]** ✅ **Hecho (03/10):** unit de `@negocia/config` (`api-environment.spec.ts`, 17 casos: `validateEnv` con defaults/errores y `resolveEnvPath` con `vi.mock` de `node:fs`). vitest v5 + script `test` en el paquete. **M**.
- **[F4-Q2]** ✅ **Hecho (03/10):** unit de `@negocia/database` (`index.spec.ts` factory con mocks de `PrismaPg`/`PrismaClient`; `check-connection.spec.ts`). `checkConnection` extraído de `scripts/check.ts` como módulo testeable. **M**.
- **[F4-Q3]** ✅ **Hecho (03/10):** `API_PORT="0"` con mensaje dedicado (puerto efímero) vs malformado en `validateEnv`. **B**.
- **[F4-Q4]** ✅ **Hecho (03/10):** Health extendido con Redis (`DependencyHealth`, `DEPENDENCY_PROBES` array, `RedisDependencyProbe`; `REDIS_URL` obligatoria). **M**. → M7.
- **[F4-Q5]** ✅ **Hecho (30/09):** matriz `canInviteRole` en `roles.ts` (ver F1-C1). **M**.

### Fase 5 — Testing
- **[F5-T1]** E2E de carrera real de `refresh` con dos procesos (esperanza: 1 gana, otro→rollback+familia revocada). **A**.
- **[F5-T2]** Tests web cuando exista UI (login, onboarding, gestión). **A**.
- **[F5-T3]** Configurar `coverage` con thresholds mínimos. **M**.

### Fase 6 — Seguridad
- **[F6-S1]** Verificar/implementar hash dummy en login (anti-timing). **A**.
- **[F6-S2]** Auditoría de campos logueados (no tokens/secretos; revisar IP/user-agent). **M**.
- **[F6-S3]** Evaluar firma asimétrica ES256 + rotación `kid` en producción; rotación segura de `JWT_SECRET`. **A**.

### Fase 7 — Deployment
- **[F7-D1]** Entorno objetivo (Cloudflare per diseño): dominios, proxy, HTTPS; web + api envs. **C**.
- **[F7-D2]** CD ejecutando `prisma migrate deploy` antes del deploy. **C**.
- **[F7-D3]** Secrets manager; credenciales provider email/WhatsApp/LLM; `JWT_SECRET` de producción rotada. **C**.
- **[F7-D4]** Procesos: workers BullMQ separados; healthchecks en orquestación. **A**.

### Fase 8 — Documentación final
- **[F8-D1]** Crear artefactos ausentes de Fase 2+: `ai-tool-calling.md`, `docs/flows/*`, `docs/api/appointments.md`, `docs/database/erd.md`, ADR RAG. Ya existen: `whatsapp.md`, `api/webhooks.md`, `api/conversations.md`, `security/authentication.md` y el **ADR del LLM (011, 03/10)**. **M** (en paralelo con F2-F6).
- **[F8-D2]** Revalidar este `PROJECT_CONTEXT.md` al cerrar cada fase (regla del índice `docs/README.md`). **M**.

---

## 25. Criterios de terminado

- Cada feature del sistema en producción pasa por el pipeline `pnpm verify` (o equivalente con cobertura) verde.
- Trazabilidad: cada requerimiento del roadmap tiene artefacto en `docs/` **y** tests que lo respaldan (matriz §"Matriz de trazabilidad").
- Multi-tenancy: test de aislamiento cruzado por endpoint sensible en e2e.
- Seguridad base de Fase 1 intacta (auth autogestionada, rotación atómica, filtros de error, rate, validación) al añadir cualquier feature.
- Sin secretos en el repo; `.env` no commiteado; CI verde en main.
- Documentación sincronizada: nada de README/docs contradiciendo el código (regla §"Documentación vs implementación").

---

## 26. Riesgos

| Riesgo | Exposición | Mitigación |
|---|---|---|
| ~~Decisión roles de invitación sin resolver → permiso indebido~~ | ~~Media (negocio)~~ | ~~F1-C1~~ → ✅ matriz `canInviteRole` (30/09) |
| HS256 + secreto único centralizado | Alta en prod | S3, secrets manager, TTL/corto+releer BD |
| Timing de login por email | Baja-media | S1 |
| ~~Email mock en producción (olvido)~~ | ~~Media~~ | ✅ **mitigado (03/10):** `validateEnv` bloquea `EMAIL_DRIVER=mock` con `NODE_ENV=production` (ADR-009) |
| Redis como infra ya consumida (cola whatsapp-events) | Baja | probe en readiness + jobs con reintentos/deduplicación en Postgres |
| Desviación doc↔código recurrente | Media (mantenibilidad) | ADR-009 + regla de sincronización + este doc |
| Sin cobertura configurada | Media | F5-T3 |
| Backups/RLS/resiliencia no definidos para prod | Alta en despliegue | F7-D*; definir RLS en Fase 2 |

---

## 27. Información faltante

- **Decisión comercial:** números finales de planes/precios (`PLAN_CATALOG` vs diseño §27) y thresholds de mensajes.
- **~~Decisión `INVITABLE_ROLES`~~** → decidida en §18.item3/F1-C1 (matriz `canInviteRole`).
- **Proveedor de email** definitivo y plantillas; ~~**proveedor LLM**~~ → **decidido: OpenRouter**
  (ADR-011, §21 y F3-3a); siguen abiertos **real-time** (SSE vs Socket.IO) y el modelo de
  **memoria/streaming** de la conversación (hoy: completions no-streaming por cola).
- **Alcance onboarding web** (¿qué se verá primero?); **método de sesión web** (cookies vs bearer + refresh en JS).
- **Despliegue** concreto (Cloudflare Workers/container, regiones, backups, metrics vendor).
- **Limpieza de tokens/expirados** (¿job diario? TTL en cola?).
- **RLS**: tablas y plazos de activación.
- **No determinado con la información disponible:** SLA de uptime, costos por tenant, compliance (LGPD?), política de retención de datos, y roadmap cuantificado de precio/uso.

---

## 28. Instrucciones para futuros agentes de IA

1. **Antes de tocar cualquier feature nueva de negocio** lee: `PROJECT_CONTEXT.md` (este), `docs/README.md`, `docs/architecture/*`, `docs/adr/*` correspondientes y `fases/README.md`. El código es la fuente de verdad superior.
2. **No reescribas** auth, guards, errores, plan-catalog ni el esquema Prisma sin alto de arquitectura (detectaría deuda y no conservo la rama).
3. **Respeta el patrón:** para una feature Nueva de Fase 2+ crear primero un **ADR/artefacto** en `docs/` si cambia DB/seguridad/multi-tenancy/concurrencia/API (regla §29 original), luego implementar en las capas definidas y dejar bitácora en `fases/`.
4. **No emplees `INIT_CWD` como única base** → usar `resolveEnvPath()` de `@negocia/config` (ya incorporado); si lanzas procesos anidados, verifica que el `.env` se resuelva.
5. **Guards globales ya registrados**: NO adiciones otro guard a la cadena sin revisar `app.module.ts` comentado (orden fijo; fail-closed; `@Public` la única excepción).
6. **No rompas el invariante de dominio**: `AppError` subclases con códigos del catálogo (la spec de paridad en `contracts` debe seguir verde). Toda mutación que toque OWNER usa `lockActiveOwners`.
7. **Tests:** corre `pnpm verify` completo antes de cerrar; maletas de integración/e2e usan `TEST_DATABASE_URL` y BD real.
8. **Documentación:** si editas un doc, actualiza su índice (`docs/README.md`); si cambias comportamiento, actualiza docs o registra desviación (como hizo ADR-009).
9. **No menciones "MEMBER"** en identity/roles (la copia de transporte y migración usan OWNER/ADMIN/AGENT y la spec lo comprueba).
10. **Env:** nunca comitees `.env`; para cualquier prueba local copia `.env.example`; `JWT_SECRET` >=32 bytes es obligatoria.
11. **Webhook WhatsApp (F2-3):** el endpoint es ingestión pura — no proceses negocio dentro del request; mantén `rawBody: true`, `@HttpCode(200)`, firma HMAC y la UNIQUE `provider_event_id` (ADR-010). El worker (`start:worker`) es un proceso separado del mismo `apps/api`; nunca lo importes dentro del web server.

---

# 29. AI DEVELOPMENT CONTEXT

### Archivos a revisar antes de modificar
- `packages/database/prisma/schema.prisma` + migraciones (`prisma/migrations/*`) → toda entidad nueva.
- `apps/api/src/app.module.ts` (guards/filtros/interceptor), `apps/api/src/main.ts` (bootstrap), `packages/config/src/api-environment.ts` (env), `packages/contracts/src/errors.ts` (catálogo).
- Puertos (`apps/api/src/domain/ports/`) y su implementación (`infrastructure/**`) — no romper el contrato de `UnitOfWork`/repos.

### Qué no modificar sin analizar dependencias críticas
- El **orden de guards** (comentado en `app.module.ts:19-34`) → consumo seguro de `request.principal`/`authClaims`.
- `SessionService.rotate` (atomicidad de rotación/reuse) — cambio aquí afecta seguridad completa.
- `TenantContextGuard`/`RolesGuard`/`assertTenantInUrl` → aislamiento multitenant.
- `packages/database/src/index.ts` (factory Prisma+singleton) y `prisma.config.ts`.

### Arquitectura a respetar / patrones que mantener
Modular monolith con capas; puertos-adaptadores; guards globales en cadena; errores `AppError`/catálogo; DTOs input en `apps/api`, respuestas wire en `contracts`; versionado URI `v1`; tenant desde BD; RLS más adelante sin romper capa de aplicación.

### Decisiones ya tomadas (no reabrir sin ADR)
ADO 001-010 (ver `docs/adr/`), §21. Incluyen: no microservicios; Postgres SSOT; pnpm+turbo; Prisma 7; auth autogestionada con rotación; `validateEnv` sin Zod; plan-catalog; email mock hasta F2-1; webhook WhatsApp = ingestión (ADR-010).

### Decisiones abiertas
Las de §21-Revisar + §27 (roles invitables, proveedor email/LLM, real-time, despliegue, billing, RLS).

### Errores conocidos / limitaciones
- Bug histórico `INIT_CWD` en determinación de `.env` (resuelto con `findEnvFile`, no reintroducir cwd-only).
- ~~`INVITABLE_ROLES` muerto/ambiguo (F1-C1).~~ → resuelto: matriz `canInviteRole` en `roles.ts`.
- MockEmailAdapter solo buffer; ~~health sin Redis~~ → **hecho (M7)**; Sin cobertura de thresholds; `prisma:push` no debe usarse para programar migración; worker WhatsApp es probe.
- No hay sessions de Redis ni autenticación de web.

### Dependencias críticas
`@negocia/config` → `@negocia/database` → `apps/api`; `packages/contracts` para tipos de wire; `@prisma/adapter-pg` a PG local (17) y CI (16) — compatibilidad ya probada.

### Comandos
```
# instalar
pnpm install
# infra
pnpm db:up ; pnpm db:ps ; pnpm db:check
# dev (API :4000 + web :3000)
pnpm dev
# checks completos
pnpm verify            # lint+typecheck+build+test+test:integration+test:e2e+db:check
pnpm test --filter @negocia/api ; pnpm test:integration ; pnpm test:e2e
# prisma
pnpm prisma:generate ; pnpm prisma:validate ; pnpm prisma:deploy ; pnpm prisma:migrate (dev)
```
### Levantar servicios / migraciones / datos
- Postgres/Redis: `pnpm db:up` (compose `infra/docker`), health `pnpm db:ps`.
- Migraciones: `pnpm prisma:deploy` (aplica orden); en dev `pnpm prisma:migrate -- --name <nombre>`.
- Datos iniciales: **no hay seeds**; los e2e/integración crean y limpian solos (schema `negocia_test`); para pruebas manuales Swagger `http://localhost:4000/api/docs`.
### Variables de entorno necesarias
Copiar `.env.example`→`.env`. Mínimo para arrancar API: `DATABASE_URL`, `JWT_SECRET` (>=32 bytes). Para tests: `TEST_DATABASE_URL`. Para web: `NEXT_PUBLIC_API_URL`.

---

# 30. Matriz de trazabilidad (requerimientos → implementación)

| Requerimiento | Implementación | Archivos | Estado | Evidencia | Pendientes |
|---|---|---|---|---|---|
| Monorepo+pipeline | pnpm workspace, turbo, CI | `pnpm-workspace.yaml`, `turbo.json`, `package.json`, `.github/workflows/ci.yml` | ✅ | verify verde 30/09 | — |
| Identidad: registrar | `AuthService.register` en tx + sesión | `modules/auth/**`, `prisma/{tenants,users,memberships}` | ✅ | e2e auth | — |
| Auth JWT corto + refresh rotation | `SessionService.issue/rotate` | `session.service.ts`, `jwt-access-token-issuer.ts`, `refresh-session.ts` | ✅ | unit+integration+auth.e2e | S3 (asimétrico en prod) |
| Reuse → familia revocada | rotate + `revokeIfActive` + rollback | `session.service.ts:130-151`, `auth.service.ts` | ✅ | e2e `reuse_detected` | — |
| Password Argon2id OWASP | adapter argon2 + validateEnv | `argon2-password-hasher.ts`, `api-environment.ts` | ✅ | unit+integration | S1 timing |
| Multi-tenant aplicación | tenant del request; guard; 404 en url mismatch | `tenant-context.guard.ts`, `roles.guard.ts`, `tenants.controller.ts` | ✅ | guards.spec + e2e tenants | RLS (ADR-006, Fase 2) |
| Roles OWNER/ADMIN/AGENT | `roles.ts` + CHECKs + **matriz `canInviteRole`** | `domain/identity/roles.ts`, migración, `invitations.service.ts` | ✅ | guards/contracts spec + unit + e2e | — |
| Invitaciones (token opaco, 48h, límite plan) | `invitations.service`, repos, partial unique | `modules/invitations/**`, migración | ✅ | invitations.integration/e2e | — (email real: F2-1 ✅) |
| Último OWNER protegido | `lockActiveOwners` FOR UPDATE + reconteo | `prisma-membership.repository.ts:158-171`, `tenant-users.service.ts` | ✅ | integration/e2e | — |
| Errores canónicos con requestId | `AllExceptionsFilter` + correlación | `filters/all-exceptions.filter.ts`, `common/correlation/*` | ✅ | smoke + api errors | — |
| Rate limiting | Throttler global + per-ruta | `app.module.ts:43,58`; controllers | ✅ | guards/e2e | — |
| Swagger | `setupSwagger` | `common/swagger/swagger.setup.ts` | ✅ | `/api/docs` | — |
| Health liveness/readiness | `health.controller` VERSION_NEUTRAL + probes | `modules/health/**`, probes `{prisma,redis}-dependency-probe` | ✅ | health.e2e (2 deps) | — |
| Web consume API | `api-status.tsx` → `/api/health` | `apps/web/**` | ⚠️ parcial | HTTP 200 live | F3-1 dashboard |
| WhatsApp webhook (ingestión) | `WhatsAppWebhookController` (`/v1/whatsapp/webhook`) + service + `meta-webhook-signature` | `modules/whatsapp/**`, `architecture/whatsapp.md` | ✅ | unit + whatsapp.e2e | — |
| WhatsApp idempotencia + cola | UNIQUE `provider_event_id` + `BullWhatsappEventQueue` | `whatsapp-event(-queue).{repository,ts}`, `queues/*` | ✅ | unit + whatsapp.integration (P2002/enqueue) | — |
| Worker WhatsApp (consume la cola) | `WhatsappEventsWorker` (`start:worker`, c5: ingestInbound + enqueue `llm-jobs` + `markProcessed`) | `infrastructure/workers/whatsapp-events.worker.ts`, `worker/main.ts`, `worker.module.ts` | ✅ | conversations.integration/e2e | tests del enqueue `llm-jobs` |
| Embedded Signup + envío real + cifrado (M9) | `EmbeddedSignupService` + `MetaOAuthClient` + `MetaCloudProvider` + `CryptoService` + `POST /v1/conversations/:id/messages` | `modules/whatsapp/**`, `modules/conversations/**`, `infrastructure/whatsapp/*`, `packages/config/src/crypto.ts`, ADR-012 | ✅ (código; sin tests propios) | `fases/M9-*` | tests M9 (unit/integration/e2e) + rotación 60d + templates |
| Proveedor de IA (`LlmProvider`) | `LlmModule` + `MockLlmAdapter` / `OpenRouterLlmAdapter` | `infrastructure/llm.*`, `domain/ports/llm-provider.ts` | ✅ (consumido por motor worker) | unit 27 (mock 4 + openrouter 23) | — |
| Motor de conversación (F3-3b parcial) | `ConversationEngineService.respond()` + `ToolExecutor`/`prompt` + `LlmJobsWorker`/`llm-job-queue` + `llm_runs` (dedup `requestId`, skip no-`BOT_ACTIVE`, `ToolCatalog` vacío) | `modules/conversation-engine/**`, `domain/llm/*`, `infrastructure/workers/llm-jobs.worker.ts`, `prisma-llm-run.repository.ts` | ⚠️ parcial (sin tests) | código cableado en `WorkerModule` | tools de negocio + handoff + gasto + tests |
| Ventas / agendamiento | no existe | — | ❌ | — | F5+ |
| Dashboard Inbox | no existe | — | ❌ | — | F3-1 |
| RAG | diseño en `docs/` | `docs/` (sin código) | ❌ | — | F2/futuro |
| Billing/límites comerciales | `PlanCatalog` (cifras internas) | `domain/plans/*` | ⚠️ parcial | unit limits.spec | F1-C3 + F2 billing |
| Recuperación contraseña | `password_reset_tokens`, `PasswordResetSender`, `POST /v1/auth/{forgot,reset}-password` | `modules/auth/**`, migración `password_reset_tokens` | ✅ | unit `auth.service.spec` + auth.e2e | — |
| Email real (Resend) | `ResendEmailAdapter`, `EmailModule`, `EMAIL_DRIVER` | `infrastructure/email-sender.resend.ts`, `email.module.ts`, config | ✅ | unit adapter + e2e | — |

---

# 31. Inventario técnico

### Archivos importantes
| Archivo | Responsabilidad | Dependencias | Importancia |
|---|---|---|---|
| `packages/database/prisma/schema.prisma` | modelo de datos | Prisma 7 | crítica |
| `packages/config/src/api-environment.ts` | env + validación | node | alta |
| `packages/contracts/src/errors.ts` + `identity.ts` | catálogo exclusivo código | — | alta |
| `apps/api/src/app.module.ts` | di módulos + guards/filter/interceptor | Nest | crítica |
| `apps/api/src/main.ts` | bootstrap+Swagger+CORS | — | crítica |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | ApiError→HTTP, sin stacks | contracts | alta |
| `apps/api/src/modules/auth/application/session.service.ts` | rotación/reuse | UnitOfWork, ports | crítica |
| `apps/api/src/common/guards/*` | auth/context/roles | AccessTokenIssuer | crítica |
| `apps/api/src/infrastructure/database/repositories/*` | accesos datos | Prisma | alta |
| `apps/api/src/domain/plans/plan-catalog.ts` | límites | — | media |
| `apps/web/app/page.tsx` + `components/api-status.tsx` | estado | contracts, fetch | media |
| `src/modules/whatsapp/application/whatsapp-webhook.service.ts` | ingest (dedup/retry/race) | ports, queues | alta |
| `src/modules/whatsapp/application/embedded-signup.service.ts` + `infrastructure/whatsapp/meta-oauth.ts` | OAuth M9 (state JWT, code→token, WABA+phones) | `JWT_SECRET`, Graph v21 | alta |
| `src/infrastructure/whatsapp/meta-cloud-provider.ts` | envío real `sendTextMessage` | Graph v21 | alta |
| `packages/config/src/crypto.ts` | `CryptoService` AES-256-GCM | `ENCRYPTION_KEY` | alta |
| `src/infrastructure/llm.openrouter.ts` + `llm.module.ts` | proveedor de IA (drivers; consumo solo worker) | `domain/ports/llm-provider`, config | media |
| `src/modules/conversation-engine/application/conversation-engine.service.ts` + `tool-executor.ts` + `prompt.ts` | motor mínimo F3-3b (sin tests) | `LLM_PROVIDER`, `WHATSAPP_PROVIDER`, `LLM_RUN_REPOSITORY` | alta |
| `src/modules/whatsapp/presentation/whatsapp-webhook.controller.ts` | firma + challenge + 200 (`/v1/whatsapp/webhook`) | config | alta |
| `src/modules/whatsapp/presentation/whatsapp-accounts.controller.ts` | cuentas + `embedded-signup/url|callback` | `EmbeddedSignupService` | alta |
| `src/modules/conversations/presentation/conversations.controller.ts` | inbox + `POST :id/messages` OUTBOUND | `ConversationsService` | alta |
| `src/infrastructure/queues/whatsapp-event-queue.ts` + `llm-job-queue.ts` + `infrastructure/workers/whatsapp-events.worker.ts` + `llm-jobs.worker.ts` | colas BullMQ + workers (ingest→LLM→OUTBOUND) | ioredis | alta |
| `src/worker.module.ts` + `src/worker/main.ts` | composition root worker | `LlmModule`, `ConversationEngineModule` | crítica |
| `.github/workflows/ci.yml` | verify en CI | — | alta |

### Endpoints — ver §11 (27 endpoints + swagger/docs).
### Entidades — ver §10 (12 entidades; relaciones y constraints en tabla ERD).
### Servicios externos — ver §13 (PG y Redis activos; Email y Meta con driver real en uso; LLM OpenRouter consumido por motor mínimo del worker).
### Variables de entorno — ver §15 (30+ en `.env.example` incl. `EMAIL_*`, `LLM_*`, `META_*`, `ENCRYPTION_KEY`; `JWT_SECRET`/`DATABASE_URL` obligatorias).

---

# 32. Diagramas (estado real)

Arquitectura (§6), ERD (§10), y flujos de auth (§9) en Mermaid. **Diagramas "estado final"** (WhatsApp+LLM) quedan documentados conceptualmente en `docs/legacy/project-context-diseno-original.md` §13, §17 y en el roadmap §24; no corresponden a código existente.

---

# 33. Documentación vs implementación (discrepancias registradas)

| # | La documentación dice… | El código dice… | Dónde | Estado |
|---|---|---|---|---|
| D1 | "Sin autenticación / JWT no implementado" | Fase 1 auth completa operativa | `README.md:5,136-138` vs `modules/auth` | ✅ cerrado (F1-C2 + sincronización 03/10) |
| D2 | "el paquete database quedará conectado cuando exista lógica" | ya está conectado y usado por la API | `README.md:127` vs `app.module.ts`/repos | ✅ cerrado (03/10) |
| D3 | ENV valida con **Zod** | `validateEnv` sin Zod | `docs/architecture/dependency-rules.md:34` | ✅ resuelto por ADR-009 |
| D4 | rol M-… no define `INVITABLE_ROLES` | ~~INVITABLE = ADMIN/AGENT pero DTO permitía OWNER; gate real `@Roles`~~ → **resuelto**: matriz `canInviteRole` (OWNER→todo; ADMIN→ADMIN/AGENT) con 403 | `invitation-input.dto.ts`, `roles.ts` | ✅ cerrado (30/09) |
| D5 | planes comerciales 1/3/5 users, 50/130/200 productos, 1k/2k/3.5k msgs | `PLAN_CATALOG` 2/10/50 users, 10/100/1k productos, 500/10k/100k msgs | diseño original §27 vs `plan-catalog.ts:14-16` | ⚠️ a reconciliar (F1-C3) |
| D6 | `refresh_tokens` sin `session_id/tenant_id` en `schema.md` | presente desde M-4 | `docs/database/schema.md` vs migración M-4 | ✅ cerrado (F1-C4) |
| D7 | "health/ready consulta PostgreSQL" | correcto, pero sin Redis | `README.md:104-109` vs `prisma-dependency-probe` | ✅ cerrado (Q4) |
| D8 | artefactos §30 original (whatsapp.md, flows/*, webhooks, ERD, security/auth, ADR LLM) | ausentes | `docs/` | ⚠️ parcial (F8-D1): ya existen whatsapp.md, api/webhooks.md, api/conversations.md, security/authentication.md, **ADR-011 del LLM y ADR-012 Embedded Signup/envío/cifrado**; faltan flows/*, ERD, `ai-tool-calling.md` y ADR RAG |
| D9 | el identificador de hito `M8` se usaba para dos entregables (conversaciones ya implementado y Embedded Signup/envío real aún pendiente) | un hito por número: `M8` = conversaciones (`fases/M8-…`), el diferido pasa a **M9 (implementado, `fases/M9-embedded-signup-envio-real.md`)** | `fases/**`, `README.md`, `docs/**`, ADR-010 (nota de trazabilidad) | ✅ cerrado |
| D10 | `F3-3` mezclaba en un solo hito el proveedor de IA y el motor de conversación (cola, tools, `llm_runs`) | dos entregables: **F3-3a** = `LlmProvider` + driver OpenRouter (**M10**, ADR-011) y **F3-3b** = motor, tools, handoff y gasto (**parcial: `ConversationEngineService` + `llm-jobs` + `llm_runs` existen, `ToolCatalog` vacío, sin tests**) | `fases/M10-…`, ADR-011, §20/§24 | ⚠️ parcial (falta cerrar tools/handoff/tests/gasto) |
| D11 | PROJECT_CONTEXT afirmaba "canal solo entrante; envío/Signup en M9 pendiente" y rutas `/api/webhooks/whatsapp` | código trae M9 hecho + rutas reales `/api/v1/whatsapp/webhook`, `/api/v1/whatsapp/accounts/...`, `POST /v1/conversations/:id/messages`, 12 tablas, `accessTokenEncrypted` | `meta-cloud-provider.ts`, `meta-oauth.ts`, `crypto.ts`, `conversations.controller.ts:103`, `schema.prisma`, `fases/M9-*` | ✅ cerrado en esta sincronización |
| D12 | PROJECT_CONTEXT + `capacidades-actuales.md` + `pendiente-fase-2.md` afirmaban "LLM sin consumidor; falta cola `llm-jobs` y tabla `llm_runs`" | motor mínimo cableado solo en worker: `WhatsappEventsWorker`→`llm-jobs` (`wa:<messageId>`)→`LlmJobsWorker`→`engine.respond()`; `AppModule:56-58` aún dice "sin consumidor HTTP" (cierto solo para HTTP) | `worker.module.ts`, `whatsapp-events.worker.ts:53-60`, `llm-jobs.worker.ts`, `conversation-engine.service.ts`, `schema.prisma: LlmRun` | ⚠️ parcial (documentado como F3-3b parcial; faltan tests + tools de negocio) |

---

# 34. Validación final (realizada 06/10/2026 — sincronización M9 + motor)

- Rutas/nombres citados existen (verificados vía read/glob: `main.ts`, `app.module.ts`, `worker.module.ts`, `worker/main.ts`, `session.service.ts`, `all-exceptions.filter.ts`, `prisma-membership.repository.ts`, `prisma-conversation.repository.ts`, `prisma-llm-run.repository.ts`, `prisma-whatsapp-account.repository.ts:85,106`, `jwt-auth.guard.ts`, `auth.controller.ts`, `whatsapp-webhook.controller.ts`, `whatsapp-accounts.controller.ts:70,83`, `conversations.controller.ts:103`, `conversation-engine.service.ts`, `whatsapp-events.worker.ts:53-60`, `llm-jobs.worker.ts`, `llm-job-queue.ts`, `meta-cloud-provider.ts:48-54`, `meta-oauth.ts`, `crypto.ts`, `invitation-input.dto.ts`, `plan-catalog.ts`, `schema.prisma` (12 modelos), 7 migraciones, `.env.example`, CI, compose).
- F3-3b verificado como **parcial**: cableado real en `WorkerModule` (whatsapp→llm-jobs→engine→OUTBOUND+`llm_runs`), `ToolCatalog` vacío (sin `register`), sin `*.spec.ts` de engine/prompt/executor/workers; `AppModule:56-58` "sin consumidor" solo vale para HTTP.
- "Completadas" respaldadas con pruebas/evidencia de archivos y suites verdes (M10: 257 API + 44 config + 11 contracts + 7 database). "Pendientes" con motivo concreto (tests M9/engine, tools de negocio, handoff F6-3, rotación 60d, templates).
- Sin secretos en este documento (no se replican valores de `.env`).
- Incertidumbres remanentes consignadas en §27.

---
*Fin de PROJECT CONTEXT — negocIA (actual).*