# Desarrollo local — infraestructura y flujo de trabajo

Guía para levantar y verificar el entorno de desarrollo local del monorepo `negocIA` desde cero.

## 1. Requisitos

| Herramienta | Versión | Notas |
|---|---|---|
| Node.js | >= 24 LTS | Ruta runtime fijada en `engines` |
| pnpm | >= 12 | `npm i -g pnpm@12.6.0` o Corepack |
| Docker | cualquier versión actual | Incluye `docker compose` |
| PostgreSQL | — | Se corre en Docker (17), no se instala local |
| Redis | — | Se corre en Docker (7), no se instala local |

## 2. Variables de entorno

Solo existe un archivo fuente: **`.env` en la raíz del repositorio** (copia de `.env.example`). Nunca se commitea.

### Dónde se lee `.env`

| Consumidor | Mecanismo | Programa referido |
|---|---|---|
| `apps/api` | `@nestjs/config` con `envFilePath` resuelto desde la raíz (`resolveEnvPath`) | `@negocia/config` |
| `packages/database` | `prisma.config.ts` (`dotenv` apunta al `.env` raíz) | `prisma generate/migrate/studio/db:check` |
| `apps/web` | `next.config.ts` carga el `.env` raíz y expone `NEXT_PUBLIC_*` | `next dev/build` |

La resolución usa `INIT_CWD` de pnpm (el directorio donde ejecutaste `pnpm`). Por eso **se ejecutan los comandos desde la raíz del repo**; si se ejecutan desde otra carpeta, cae en `process.cwd()`.

### Referencia de variables

**API (`apps/api`)**

| Variable | Default | Descripción |
|---|---|---|
| `NODE_ENV` | `development` | `development | test | production` (validado) |
| `API_HOST` | `0.0.0.0` | Host donde escucha la API |
| `API_PORT` | `4000` | Puerto de la API |
| `LOG_LEVEL` | `info` | `fatal | error | warn | info | debug` (validado) |
| `CORS_ORIGINS` | `http://localhost:3000` | Orígenes CORS separados por coma |

**Web (`apps/web`)**

| Variable | Default | Descripción |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api` | URL pública de la API (prefijo global `/api`) |

**Infraestructura**

| Variable | Default | Descripción |
|---|---|---|
| `POSTGRES_DB` | `negocia` | Base de datos |
| `POSTGRES_USER` | `negocia` | Usuario |
| `POSTGRES_PASSWORD` | `negocia` | Contraseña (solo dev) |
| `POSTGRES_PORT` | `5432` | Puerto mapeado en el host |
| `DATABASE_URL` | `postgresql://negocia:negocia@localhost:5432/negocia?schema=public` | URL usada por Prisma |
| `REDIS_PORT` | `6379` | Puerto mapeado en el host |
| `REDIS_URL` | `redis://localhost:6379` | Redis (cola `whatsapp-events` BullMQ + probe readiness — M7) |

Si `.env` no existe, `docker compose` y Prisma usan los defaults indicados (postgres/negocia en localhost:5432).

## 3. Instalar dependencias

```bash
pnpm install
```

- Determinista (`pnpm-lock.yaml`).
- En Windows/OneDrive el `.npmrc` fuerza `package-import-method=copy` (evita hardlinks problemáticos).
- Los scripts de build de dependencias están permitidos explícitamente en `pnpm-workspace.yaml` → `allowBuilds` (mapa `paquete: true`).

## 4. Infraestructura (PostgreSQL 17 + Redis 7)

```bash
# Levantar contenedores en background
pnpm db:up

# Estado y healthchecks
pnpm db:ps

# Logs
pnpm db:logs

# Detener (los volumes se conservan)
pnpm db:down
```

Comando directo equivalente:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

| Servicio | Contenedor | Puerto host | Healthcheck |
|---|---|---|---|
| PostgreSQL 17 | `negocia-postgres` | `5432` | `pg_isready` |
| Redis 7 | `negocia-redis` | `6379` | `redis-cli ping` |

Persistencia en volumes nombrados: `negocia-postgres-data` (PGDATA) y `negocia-redis-data` (AOF `/data`). El path de datos de Redis se monta en `/data` y se habilita AOF (`--appendonly yes`).

Verificación manual rápida:

```bash
docker compose -f infra/docker/docker-compose.yml exec postgres pg_isready -U negocia -d negocia
docker compose -f infra/docker/docker-compose.yml exec redis redis-cli ping   # PONG
```

## 5. Prisma (packages/database)

El paquete provee el schema, las migraciones y una factory de `PrismaClient` usando **Prisma 7** con driver adapter `@prisma/adapter-pg`.

```bash
# Regenerar cliente (también corre automáticamente en `pnpm build` del paquete)
pnpm prisma:generate

# Validar schema + configuración
pnpm prisma:validate

# Crear/aplicar migración de desarrollo (interactivo)
pnpm prisma:migrate

# Aplicar migraciones en orden (no interactivo)
pnpm prisma:deploy

# Verificar conexión a PostgreSQL end-to-end (SELECT 1 vía Prisma)
pnpm db:check
```

Notas:

- El cliente generado queda en `packages/database/src/generated/prisma/` (gitignored). Se importa desde `packages/database/src/index.ts`.
- `prisma.config.ts` centraliza la configuración del CLI (schema, migraciones, `datasource.url`). El `url` en el `datasource` del schema NO se usa en Prisma 7.
- **Schema de identidad (Fase 1)** aplicado por la migración `identity-core` (`20260924012558_identity_core`): tablas `tenants`, `users`, `memberships`, `refresh_tokens`, `invitations` y `verification_tokens` — definidas en `docs/database/schema.md`. El SQL de la migración fue editado manualmente para incluir CHECKs de enums, el partial unique `(tenant_id, email) WHERE status='PENDING'` en invitaciones, el índice parcial de sesiones activas y el índice `lower(email)` (ver `docs/database/schema.md §9.6`).

## 6. API (apps/api)

```bash
pnpm --filter @negocia/api dev     # nest start --watch (puerto 4000)
```

- **Bootstrap** en `src/main.ts`: prefijo global `/api`, CORS de desarrollo, shutdown hooks.
- **Configuración**: `ConfigModule.forRoot` con `validate` de `@negocia/config` (falla al arrancar si el env es inválido).
- **Logging estructurado**: `StructuredLogger` (JSON por línea) inyectado como logger global de Nest.
- **Correlation ID**: middleware registrado para todas las rutas; genera/acepta `x-request-id` y lo propaga con `AsyncLocalStorage`; se replica en el header de respuesta y se incluye en logs y en `/health`.
- **Errores**: `AppError` (base sin dependencias de framework) + subclases clasificadas en `src/domain/errors` (`Validation`, `Authentication`, `Authorization`, `NotFound`, `Conflict`, `RateLimit`, `ExternalProvider`, `Llm`, `Database`, `InternalServer`). Un único `AllExceptionsFilter` global (`APP_FILTER`) las mapea al envelope `ApiError` de `packages/contracts` (código canónico + `requestId`), sin stack traces al cliente.
- **Validación**: `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`); los DTOs usarán `class-validator`.
- **Swagger/OpenAPI**: `GET /api/docs` (UI) y `GET /api/docs-json`, securityScheme `bearer`. Plugin `@nestjs/swagger` en `nest-cli.json`.
- **Rate limiting**: `@nestjs/throttler` global (`APP_GUARD`, 100 req/60 s); `@SkipThrottle()` en `/api/health`; límites por ruta en los endpoints de auth (registro 5/10 min, login 10/5 min, refresh 60/5 min, switch-tenant 30/5 min, revoke-all 10/5 min). El `429` está verificado en la suite e2e.
- **Health check**: `GET /api/health` (sin versión: `@Version(VERSION_NEUTRAL)`, porque el URI versioning global desplazaría la ruta a `/api/v1/health` y el front la consume desde `NEXT_PUBLIC_API_URL`).

```bash
curl -s http://localhost:4000/api/health
curl -si http://localhost:4000/api/health | Select-String -Pattern "x-request-id"
```

### Estructura de la app (lista para arquitectura modular/layered)

```text
src/
├── app.module.ts
├── main.ts
├── common/
│   ├── correlation/       # middleware + AsyncLocalStorage + servicio de propagación
│   ├── filters/           # AllExceptionsFilter (mapea AppError/HttpException → ApiError)
│   ├── swagger/           # setup Swagger UI + OpenAPI (bearer)
│   └── logger/            # StructuredLogger (adapter de LoggerService)
├── domain/
│   └── errors/            # AppError + subclases (sin deps de Nest/framework)
└── modules/
    └── health/            # controller (presentación) + service (aplicación)
```

Cuando la lógica de negocio llegue, cada `modules/*` seguirá la capa del monorepo:

`presentation (controller/DTO/guard) → application (caso de uso/service) → domain (entidades, puertos) → infrastructure (repositorios/adapters)` — ver `docs/architecture/dependency-rules.md`.

## 7. Web (apps/web)

```bash
pnpm --filter @negocia/web dev    # next dev (puerto 3000)
```

- Next.js App Router + React 19 + Tailwind CSS v4 (config CSS-first vía `@tailwindcss/postcss`).
- La página inicial (`app/page.tsx`) verifica el stack y el componente cliente `ApiStatus` consulta `GET {NEXT_PUBLIC_API_URL}/health` (prueba CORS + contratos compartidos desde el frontend).
- No consume `packages/database`: solo `packages/contracts` (regla normativa del monorepo).

## 8. Lint, typecheck y build

```bash
pnpm build        # packages -> apps (orden Topológico por Turborepo)
pnpm lint         # ESLint flat (configs base / nest / next en @negocia/eslint-config)
pnpm typecheck    # tsc --noEmit en todos los paquetes
```

## 9. Tests

Tres suites, todas con Vitest y todas lanzadas desde la raíz:

```bash
pnpm test              # unitarias (turbo; hoy solo @negocia/api)
pnpm test:integration  # DI real + PostgreSQL real
pnpm test:e2e          # HTTP real con Supertest sobre la app completa
pnpm verify            # lint → typecheck → test → integration → e2e
```

| Suite | Config | Base de datos | Requiere PostgreSQL |
|---|---|---|---|
| Unitaria | `apps/api/vitest.config.mts` | ninguna | no |
| Integración | `apps/api/vitest.integration.config.mts` | `negocia_test` | sí |
| E2E | `apps/api/vitest.e2e.config.mts` | `negocia_test` | sí |

Las dos últimas comparten un único schema de test, por lo que corren **en serie** y su `globalSetup` lo recrea (`DROP SCHEMA … CASCADE` + `prisma migrate deploy`) antes de cada ejecución. Se aíslan del resto con `schema=negocia_test` en la URL: nunca apuntan a la base de desarrollo. Las filas y los contadores de throttler se resetean entre tests (`resetDatabase`, `resetThrottler`); el e2e comparte una sola instancia de Nest para no arrancar la app 27 veces.

`TEST_DATABASE_URL` debe existir en `.env` y apuntar a una URL con un schema de test explícito. `pnpm verify` exige la base de datos arriba: las suites de integración y e2e no se saltan si falta.

## 10. Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| `prisma generate` dice que falta `DATABASE_URL` | Ejecutaste desde otra carpeta y no hay `.env` | Ejecutar desde la raíz, o exportar `DATABASE_URL` |
| La API no arranca y muestra "Variables de entorno inválidas" | `.env` con valores fuera de rango | Corregir según `@negocia/config` (el mensaje lista cada variable); `JWT_SECRET` exige ≥ 32 bytes en todos los entornos |
| `prisma migrate reset` no se puede ejecutar | Prisma lo bloquea para agentes | No hace falta: el setup de tests usa `DROP SCHEMA` + `migrate deploy` |
| Las suites de integración/e2e fallan al arrancar | `TEST_DATABASE_URL` ausente o sin `schema=negocia_test` | Definir `TEST_DATABASE_URL` en `.env` y arrancar PostgreSQL (`pnpm db:up`) |
| Puerto 5432/6379 ocupado | Otro proceso usa el puerto | Cambiar `POSTGRES_PORT`/`REDIS_PORT` en `.env` |
| `db:check` falla con auth | `POSTGRES_*` de `.env` no coincide con `DATABASE_URL` | Ajustar password/url en `.env` |
| Conexión lenta/freezes en Windows | hardlinks de pnpm sobre OneDrive | Ya mitigado por `package-import-method=copy` en `.npmrc` |
| Web no ve la API | CORS o la API no corriendo | Revisar `CORS_ORIGINS` y que `apps/api` esté arriba |

## 11. Flujo diario recomendado

```bash
pnpm db:up            # infraestructura
pnpm dev              # API + Web en paralelo
pnpm db:check         # sanidad de la conexión Prisma
pnpm verify           # antes de commitear: lint, typecheck, unit, integration, e2e
```

Al detener todo:

```bash
pnpm db:down          # contenedores abajo, datos persistentes
```