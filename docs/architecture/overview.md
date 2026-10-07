# 1. Objetivo

Definir la arquitectura de alto nivel del SaaS IA para WhatsApp: modular monolith, capas lógicas, runtimes y las decisiones que aplican a todo el producto.

# 2. Contexto actual del repositorio

- El repositorio contiene únicamente los artifacts en `docs/` y `PROJECT_CONTEXT.MD`.
- No existe código, schema, migraciones ni herramientas configuradas.
- El stack objetivo está definido por `PROJECT_CONTEXT.MD`: NestJS + TypeScript (backend), Next.js + React + Tailwind (frontend), PostgreSQL como fuente de verdad, Redis + BullMQ, Meta Cloud API y una abstracción de proveedor LLM.

# 3. Estilo arquitectónico

**Modular monolith.** Un solo backend desplegable (NestJS) organizado por módulos funcionales (Auth, Tenants, Users, Invitations, y en fases futuras WhatsApp, Conversations, Sales, Scheduling, Billing). No se crean microservicios hasta que exista una razón operacional real.

El código se organiza en cuatro capas lógicas:

```text
Presentation        (controllers, DTOs, guards HTTP)
    ↓
Application         (casos de uso, orquestación, transacciones)
    ↓
Domain             (entidades, servicios de dominio, reglas, puertos)
    ↓
Infrastructure     (Prisma/PostgreSQL, Redis, BullMQ, HTTP externos, adapters)
```

Reglas de dependencia formales en `architecture/dependency-rules.md`.

# 4. Runtimes y herramientas

| Componente | Tecnología | Notas |
|---|---|---|
| Runtime | Node.js 24 LTS | Fijado en `engines`, Dockerfile y CI. No depender de APIs experimentales. |
| Backend | NestJS 11 sobre Express | No usar Express directo como arquitectura de aplicación. |
| Frontend | Next.js + React + TypeScript | App Router; Tailwind para UI. |
| ORM | Prisma 7 (`@prisma/adapter-pg`) | SQL raw permitido para invariantes Postgres. Ver ADR-004. |
| BD | PostgreSQL 17 | Fuente de verdad. RLS diseñada desde Fase 1, activa en Fase 2. |
| Cache/jobs | Redis 7 + BullMQ | Nunca la fuente de verdad de datos de negocio. |
| Logging | StructuredLogger + correlation IDs | Ver sección Observabilidad. |
| Env config | validateEnv (manual, no Zod) | Solo configuración; los DTOs usan class-validator. |
| API docs | Swagger / OpenAPI | Generada desde NestJS. |
| Passwords | Argon2id vía `argon2` | Detrás de la abstracción `PasswordHasher`. |
| Email | Adapter `EmailSender` | `EMAIL_DRIVER=mock` (dev) → `resend` (Resend, en producción; `mock` bloqueado en prod) |

# 5. Diagrama de arquitectura

```text
apps/web (Next.js + contracts)
        │  HTTPS  API JSON (swagger)
        ▼
┌──────────────────────────────────────────────┐
│ apps/api (NestJS — Express)                  │
│  Presentation                                │
│   ├─ controllers, DTOs (class-validator)     │
│   ├─ auth guard → TenantContextGuard         │
│   └─ global pipes / exception filter          │
│       │                                      │
│  Application                                 │
│   ├─ AuthService, TenantService,             │
│   │  UserService, InvitationService,         │
│   │  LimitsService                           │
│       │                                      │
│  Domain                                      │
│   ├─ errores clasificados                    │
│   ├─ puertos: PasswordHasher, EmailSender    │
│   └─ reglas: planes/límites, miembros, roles │
│       │                                      │
│  Infrastructure                              │
│   ├─ PrismaService (packages/database)       │
│   ├─ RedisModule / BullModule (futuro)       │
│   └─ adapters: argon2, email (mock/resend)            │
└───────┬──────────────────────────────────────┘
        │  Prisma (fuente de verdad; RLS en Fase 2)
        ▼
 PostgreSQL 17                    Redis 7
 (SSOT, RLS-aware)                (cache/jobs auxiliares, BullMQ futuro)
```

# 6. Puerto — adaptadores

Los servicios de aplicación dependen de **puertos** de dominio, no de implementaciones:

- `PasswordHasher` (dominio) ← implementación con `argon2` (infra)
- `EmailSender` (dominio) ← `MockEmailAdapter` (dev) / `ResendEmailAdapter` (prod; ADR-009)
- `LlmProvider` (dominio, F3-3a) ← OpenRouter (drivers mock/openrouter); motor de conversación F3-3b
- `WhatsAppProvider` (dominio, Fase 2) ← Meta Cloud API

Así el dominio no conoce SDKs externos y el `AuthService` no conoce la librería `argon2`.

# 7. Multi-tenancy (resumen)

Ver `architecture/multi-tenancy.md` y `security/tenant-isolation.md` para el detalle.

- Shared database + shared schema + columna `tenant_id` en tablas tenant-scoped.
- Aislamiento primario por capa de aplicación (contexto autenticado/validado).
- RLS como segunda capa de defensa: **diseñada en Fase 1, activada progresivamente en Fase 2** (ADR-006).
- El `tenant_id` nunca proviene del frontend ni se acepta como dato de entrada no validado.

# 8. Autenticación (resumen)

Ver `architecture/authentication.md`.

- Auth autogestionada en NestJS: access JWT corto + refresh token rotation (hash en BD) + detección de reuse.
- JWT con claims mínimos (`sub`, `jti`, `tenant_id` activo). **No es fuente de verdad de permisos.**
- Password Argon2id detrás de `PasswordHasher`.
- Invitaciones y verificación de email forman parte de Fase 1 (ADR-008).

# 9. Observabilidad

- Structured logging en JSON, una línea por escritura, respetando `LOG_LEVEL`; `request id`/correlation id generado en cada request HTTP y cada job.
  - Nota: este doc decía "con pino". No hay dependencia de pino; la implementación es `StructuredLogger` (apps/api), que cumple el contrato de `LoggerService` de Nest. La línea se ajusta al código real.
- Liveness y readiness separados: `/api/health` no consulta dependencias; `/api/health/ready` sondea PostgreSQL y responde 503 si no responde.
- Contexto de log: `request_id`, `tenant_id` (cuando sea seguro), `user_id`, `job_id` (BullMQ), `provider_message_id` (Fase 2).
- Redacción forzosa: nunca loggear tokens de acceso, passwords, hashes ni datos PII innecesarios.
- Filtro global de errores: los errores se clasifican y mapean a HTTP; nunca se devuelven stack traces al cliente; los errores se registran con su correlación.
- Previsión (Fase 2+): duración de jobs, reintentos, errores de LLM y de Meta.

# 10. Fases de referencia

| Fase | Alcance | Estado |
|---|---|---|
| Fase 1 | Monorepo, identidad, tenants, auth, invitaciones, límites/planes | **Completada** (identidad, onboarding con invitaciones, verificación de email y gestión de usuarios del tenant en verde; `pnpm verify` exit 0) |
| Fase 2 | Meta Cloud API, webhooks, mensajes, conversaciones, RLS activa | **Parcial** (webhook firmado+idempotente, cola y worker, conversaciones y mensajes persistidos con inbox de lectura; pendientes Embedded Signup, envío real y **RLS**) |
| Fase 3 | LLM abstraction, tool calling, IA conversacional, handoff | Pendiente |
| Fase 4 | Modo Ventas | Pendiente |
| Fase 5 | Modo Agendamiento | Pendiente |
| Fase 6 | Dashboard completo | Pendiente |
| Fase 7 | RAG, analytics, billing | Pendiente |