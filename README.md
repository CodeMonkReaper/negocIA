# negocIA

SaaS B2B multi-tenant: agenda y ventas por WhatsApp con asistente de IA para PyMEs de Chile y LATAM.

**Estado actual:** Fase 1 completada — identidad multi-tenant (auth JWT corto + refresh rotation con detección de reuse, tenants, usuarios, membresías, roles e invitaciones) + F2-1/F2-2 (email real Resend, recuperación de contraseña) + **F2-3 canal entrante WhatsApp** (webhook firmado e idempotente + BullMQ/Redis, ADR-010) + **F2-4 conversaciones y mensajes** (persistencia inbound idempotente; `GET /v1/conversations`, `GET /v1/conversations/:id/messages`, `POST /v1/conversations/:id/messages` — envío outbound a Meta Cloud API) + **M9 Embedded Signup + cifrado de access_token** (OAuth Meta, callback público, `CryptoService` AES-256-GCM, `ENCRYPTION_KEY`; ADR-012) + **F3-3a proveedor de IA** (puerto `LlmProvider` + driver OpenRouter, ADR-011) + **F3-3b motor de conversación (mínimo funcional)** (worker encola `llm-jobs`, `ConversationEngineService.respond()`, historial de 50 mensajes). Pendiente de negocio: catálogo de tools, ventas, agendamiento, dashboard y billing.

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
| Colas (Workers) | BullMQ 5 + ioredis |

## Estructura

```text
apps/
├── api/                 # NestJS: identity (auth/sessions, tenants, usuarios, invitaciones), email/reset, webhooks WhatsApp, cuentas, conversaciones/mensajes, health, conversation-engine (+ worker `start:worker`)
└── web/                 # Next.js App Router + Tailwind, panel de estado

packages/
├── contracts/           # Contratos/tipos de wire (sin dependencias de persistencia)
├── config/              # Validación de variables de entorno + helpers de paths + CryptoService
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

# 2. Configurar variables de entorno (pide instrucciones al equipo o revisa docs)
# NOTA: No existe .env.example público por razones de seguridad.

# 3. Instalar dependencias (pnpm-lock.yaml incluido -> install determinista)
pnpm install

# 4. Levantar infraestructura (PostgreSQL 17 + Redis 7)
pnpm db:up          # docker compose -f infra/docker/docker-compose.yml up -d
pnpm db:ps          # verificar health de los contenedores

# 5. Compilar todos los paquetes (incluye generación del cliente Prisma)
pnpm build

# 6. Arrancar API y web en paralelo (Turborepo)
# Abrir una terminal y ejecutar:
pnpm dev

# 7. Arrancar el Worker (Eventos en segundo plano y motor LLM)
# Abrir una SEGUNDA terminal y ejecutar:
pnpm --filter @negocia/api start:worker

# 8. Exponer túnel local para WhatsApp (Solo si integras Meta real)
# Abrir una TERCERA terminal y ejecutar:
ngrok http 4000
# (Luego actualiza META_EMBEDDED_SIGNUP_REDIRECT_URI en tu .env y reinicia el paso 6)

# 9. Verificar
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
| `pnpm --filter @negocia/api start:worker` | Consume `whatsapp-events` y `llm-jobs` (requiere `pnpm build` previo) |
| `pnpm db:check` | Verifica la conexión a PostgreSQL desde Prisma |
| `pnpm verify` | Pipeline completo: lint → typecheck → build → test → test:integration → test:e2e → db:check |
| `pnpm prisma:generate` | Regenera el cliente Prisma |
| `pnpm prisma:migrate` | Crea/aplica migración (`prisma migrate dev`) |
| `pnpm prisma:deploy` | Aplica migraciones en orden (`prisma migrate deploy`) |
| `pnpm prisma:push` | Sincroniza el schema sin migración (`prisma db push`) |
| `pnpm prisma:studio` | Abre Prisma Studio |

## Health check

```bash
# Liveness: solo dice que el proceso está vivo. No consulta la base de datos.
curl http://localhost:4000/api/health

# Readiness: consulta PostgreSQL y Redis de verdad. 200 si responden, 503 si no.
curl -i http://localhost:4000/api/health/ready
```

## Paquetes y reglas de dependencia

- `apps/web` **solo** importa `packages/contracts` (+ `config`/`eslint-config`). **Nunca** `packages/database`.
- `packages/contracts` contiene tipos de wire sin lógica de persistencia (ver `docs/architecture/dependency-rules.md`).
- `apps/api` es un modular monolith y la API ya consume `packages/database` (Prisma) directamente.

## Documentación

- `PROJECT_CONTEXT.MD` — documento maestro de contexto y arquitectura generada por auditoría.
- `docs/infrastructure/local-development.md` — guía de desarrollo local.
- `docs/README.md` — índice de artifacts de arquitectura (ADR, multi-tenancy, auth, schema…).

## Roadmap

Fase 1 (fundación) **completada**.
Fase 2 **completada** (proveedor de email, recuperación de contraseña, canal entrante WhatsApp, persistencia de conversaciones/mensajes de forma idempotente).
M9 **completada** (Embedded Signup Meta, callback público, cifrado AES-256-GCM de `access_token`).
Fase 3: **proveedor de IA LlmProvider (OpenRouter) implementado**, y **motor de conversación funcional en el worker** (`llm-jobs`, `ConversationEngineService.respond()`, persistencia de `llm_runs`).

**Pendiente de implementar:**
Catálogo de herramientas (Tools) del LLM, handoff a humanos, productos/clientes/pedidos/servicios/profesionales/reservas, dashboard de negocio y billing. La web todavía no consume la API completamente.