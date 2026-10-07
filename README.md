# negocIA

SaaS B2B multi-tenant: agenda y ventas por WhatsApp con asistente de IA para PyMEs de Chile y LATAM.

**Estado actual:** Fase 1 completada — identidad multi-tenant (auth JWT corto + refresh rotation con detección de reuse, tenants, usuarios, membresías, roles e invitaciones) + F2-1/F2-2 (email real Resend, recuperación de contraseña) + **F2-3 canal entrante WhatsApp** (webhook firmado e idempotente + BullMQ/Redis, ADR-010) + **F2-4 conversaciones y mensajes** (persistencia inbound idempotente; `GET /v1/conversations`, `GET /v1/conversations/:id/messages`, `POST /v1/conversations/:id/messages` — envío outbound a Meta Cloud API) + **M9 Embedded Signup + cifrado de access_token** (OAuth Meta, callback público, `CryptoService` AES-256-GCM, `ENCRYPTION_KEY`; ADR-012) + **F3-3a proveedor de IA** (puerto `LlmProvider` + driver OpenRouter, ADR-011; sin consumidor todavía). Pendiente de negocio: motor de conversación (F3-3b), ventas, agendamiento, dashboard y billing.

## Stack

| Área | Tecnología |
|---|---|
| Runtime | Node.js 24 LTS |
| Package manager | pnpm (`packageManager` fijado con Corepack) |
| Orquestación | Turborepo |
| API | NestJS (Express) + TypeScript strict |
| Web | Next.js + React + TypeScript + Tailwind CSS v4 |
| Base de datos | PostgreSQL 17 (Docker Compose) + Prisma 7 |
| Cache | Redis 7 (Docker Compose) |

## Estructura

```text
apps/
├── api/                 # NestJS: identity (auth/sessions, tenants, usuarios, invitaciones), email/reset, webhooks WhatsApp, cuentas, conversaciones/mensajes, health (+ worker `start:worker`)
└── web/                 # Next.js App Router + Tailwind, panel de estado

packages/
├── contracts/           # Contratos/tipos de wire (sin dependencias de persistencia)
├── config/              # Validación de variables de entorno + helpers de paths
├── database/            # Prisma 7: schema, migraciones, factory de PrismaClient
└── eslint-config/       # Configuración ESLint flat compartida (base / nest / next)

infra/
└── docker/
    └── docker-compose.yml   # PostgreSQL 17 + Redis 7 con volumes
```

## Requisitos

- Node.js **>= 24** (LTS)
- pnpm **>= 12** (`npm install -g pnpm@12.6.0` o Corepack)
- Docker + Docker Compose (para PostgreSQL y Redis locales)

## Puesta en marcha desde cero

```bash
# 1. Clonar el repositorio
git clone <url> negocia && cd negocia

# 2. Copiar variables de entorno
cp .env.example .env

# 3. Instalar dependencias (pnpm-lock.yaml incluido -> install determinista)
pnpm install

# 4. Levantar infraestructura (PostgreSQL 17 + Redis 7)
pnpm db:up          # docker compose -f infra/docker/docker-compose.yml up -d
pnpm db:ps          # verificar health de los contenedores

# 5. Compilar todos los paquetes (incluye generación del cliente Prisma)
pnpm build

# 6. Arrancar API y web en paralelo (Turborepo)
pnpm dev

# 7. Verificar
#    API  -> http://localhost:4000/api/health
#    Web  -> http://localhost:3000
```

## Comandos principales

| Comando | Descripción |
|---|---|
| `pnpm install` | Instala dependencias del monorepo |
| `pnpm db:up` | Levanta PostgreSQL y Redis (Docker Compose) |
| `pnpm db:down` | Detiene la infraestructura (conserva los volumes) |
| `pnpm db:logs` | Sigue los logs de los contenedores |
| `pnpm db:ps` | Estado/health de los contenedores |
| `pnpm dev` | API (`nest start --watch`) + Web (`next dev`) |
| `pnpm build` | Build de todos los packages y apps (vía Turborepo) |
| `pnpm lint` | ESLint en todos los paquetes |
| `pnpm typecheck` | `tsc --noEmit` en todos los paquetes |
| `pnpm --filter @negocia/api start:worker` | Consume `whatsapp-events` (requiere `pnpm build` previo) |
| `pnpm db:check` | Verifica la conexión a PostgreSQL desde Prisma |
| `pnpm verify` | Pipeline completo: lint → typecheck → build → test → test:integration → test:e2e → db:check |
| `pnpm prisma:generate` | Regenera el cliente Prisma |
| `pnpm prisma:migrate` | Crea/aplica migración (`prisma migrate dev`) |
| `pnpm prisma:deploy` | Aplica migraciones en orden (`prisma migrate deploy`) |
| `pnpm prisma:push` | Sincroniza el schema sin migración (`prisma db push`) |
| `pnpm prisma:studio` | Abre Prisma Studio |

### Ejecutar solo un paquete

```bash
pnpm --filter @negocia/api dev      # solo API
pnpm --filter @negocia/web dev      # solo Web
pnpm --filter @negocia/api lint
pnpm --filter @negocia/web typecheck
```

## Health check

```bash
# Liveness: solo dice que el proceso está vivo. No consulta la base de datos,
# a propósito — un fallo de PostgreSQL no debe provocar reinicios en bucle.
curl http://localhost:4000/api/health

# Readiness: consulta PostgreSQL y Redis de verdad. 200 si responden, 503 si no.
# Es la que debe usar el balanceador para dejar de enviar tráfico.
# Nunca expone mensajes internos (solo la clase del error ante un `down`).
curl -i http://localhost:4000/api/health/ready

# CORS en desarrollo permite http://localhost:3000 (ver variable CORS_ORIGINS)
```

## Variables de entorno

Copiar `.env.example` a `.env` (raíz). Los tres bloques están separados:

- **API** (`apps/api`): `NODE_ENV`, `API_HOST`, `API_PORT`, `LOG_LEVEL`, `CORS_ORIGINS`.
- **Auth/Email** (`apps/api`): `JWT_*`, `ARGON2_*`, `EMAIL_DRIVER` (`mock`|`resend`), `EMAIL_FROM`, `EMAIL_FROM_NAME`, `APP_BASE_URL` (y `RESEND_API_KEY` con driver `resend`).
- **WhatsApp/Redis** (`apps/api`): `REDIS_URL` (obligatoria), `META_DRIVER` (`mock`|`real`, `mock` bloqueado en producción), `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_REDIRECT_URI`, `ENCRYPTION_KEY` (obligatorio si `META_DRIVER=real`).
- **Proveedor de IA** (`apps/api`): `LLM_DRIVER` (`mock`|`openrouter`, `mock` bloqueado en producción), `OPENROUTER_API_KEY` (obligatoria con `openrouter`), `LLM_MODEL` (default `openai/gpt-4o-mini`), `LLM_BASE_URL`, `LLM_TIMEOUT_MS`, y opcionales `LLM_APP_URL`/`LLM_APP_TITLE`.
- **Web** (`apps/web`): `NEXT_PUBLIC_API_URL`.
- **Infraestructura** (PostgreSQL/Redis): `POSTGRES_*`, `DATABASE_URL`, `REDIS_*`.

Detalle y dónde se lee cada variable: `docs/infrastructure/local-development.md`.

## Paquetes y reglas de dependencia

- `apps/web` **solo** importa `packages/contracts` (+ `config`/`eslint-config`). **Nunca** `packages/database`.
- `packages/contracts` contiene tipos de wire sin lógica de persistencia (ver `docs/architecture/dependency-rules.md`).
- `apps/api` es un modular monolith y la API ya consume `packages/database` (Prisma) directamente.

## Documentación

- `docs/infrastructure/local-development.md` — guía de desarrollo local.
- `docs/README.md` — índice de artifacts de arquitectura (ADR, multi-tenancy, auth, schema…).

## Roadmap

Fase 1 (fundación) **completada**: monorepo → identidad (auth JWT corto + refresh rotation con detección de reuse), tenants, usuarios, membresías, roles (OWNER/ADMIN/AGENT con matriz de invitación) e invitaciones. **F2-1/F2-2 hechas (03/10):** proveedor de email real (Resend, `EMAIL_DRIVER`) y recuperación de contraseña (`forgot/reset-password`). **F2-3 hecha (03/10):** canal entrante de WhatsApp (webhook `X-Hub-Signature-256` + idempotencia `provider_event_id` + cola BullMQ/Redis + alta manual de cuentas; ADR-010). **F2-4 hecha (03/10):** conversaciones y mensajes (el worker persiste el inbound de forma idempotente, máquina de estados pura, inbox de lectura, `POST /v1/conversations/:id/messages` outbound; `docs/api/conversations.md`). **M9 hecha (03/10):** Embedded Signup + envío real + cifrado de `access_token` (OAuth Meta, callback público, `CryptoService` AES-256-GCM, `ENCRYPTION_KEY`; ADR-012). **F3-3a hecha (03/10):** proveedor de IA `LlmProvider` con driver **OpenRouter** (`LLM_DRIVER`, `LLM_MODEL` por configuración; ADR-011) — todavía sin consumidor. Próximo hito: **F3-3b** (motor de conversación: cola `llm-jobs`, tools, handoff y `llm_runs`). Las fases siguientes (ventas, agendamiento, dashboard, billing) están detalladas en `PROJECT_CONTEXT.md` §24 (`fases/` bitácora) y `docs/pendiente-fase-2.md`.

Aún **no** implementado: RLS, **el motor de conversación que consume el LLM** (F3-3b), RAG, productos/clientes/pedidos/servicios/profesionales/reservas, dashboard de negocio ni billing, y la web todavía no consume la API. Embedded Signup, envío real de WhatsApp y cifrado de access_token ya están implementados (M9).