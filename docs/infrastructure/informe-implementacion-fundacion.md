# Informe de implementación — Fundación del monorepo negocIA

| Campo | Valor |
|---|---|
| **Proyecto** | negocIA — SaaS multi-tenant de IA para WhatsApp |
| **Entregable** | Fundación (Fase 1): scaffold del monorepo y validación del entorno local |
| **Fecha** | 24 de septiembre de 2026 |
| **Entorno de ejecución** | Windows (win32), shell PowerShell 5.1 |
| **Directorio raíz** | `C:\Users\luis_\OneDrive\Documentos\negocIA` |
| **Estado al cierre** | Compilación, lint, typecheck, infraestructura y smoke tests: **todos en verde** |

---

## 1. Resumen ejecutivo

Se implementó y validó de extremo a extremo el *foundation* del monorepo de **negocIA**: un monorepo pnpm + Turborepo con una API NestJS, una aplicación web Next.js + React + Tailwind, PostgreSQL 17 y Redis 7 desplegados localmente vía Docker Compose, acceso a datos con Prisma 7 y un conjunto de paquetes compartidos (`contracts`, `config`, `database`, `eslint-config`).

No se implementó ninguna funcionalidad de negocio (autenticación, WhatsApp, IA, catálogos, reservas, facturación, etc.); el objetivo de la fase fue dejar la infraestructura reproducible, tipada, linted y documentada para que las fases posteriores solo agreguen modelos y módulos.

Todas las verificaciones de la fase (instalación, infraestructura, generación de cliente Prisma, build, typecheck, lint y smoke tests HTTP) finalizaron correctamente y quedan registradas con su evidencia en las secciones 9 y 10.

---

## 2. Contexto y objetivos

El repositorio ya contaba con documentación de diseño normativa —`PROJECT_CONTEXT.MD` y la carpeta `docs/` con ADRs y guías de arquitectura—. Los siguientes documentos condicionan directamente esta implementación:

- **ADR-001** `monolith-modular`: modular monolith como estilo arquitectónico.
- **ADR-002** PostgreSQL como *source of truth*.
- **ADR-003** `monorepo-pnpm-turborepo`: monorepo pnpm + Turborepo.
- **ADR-004** `prisma-orm-raw-sql`: Prisma como ORM, con escape hatch de SQL crudo.
- **docs/architecture/dependency-rules.md**: reglas de dependencias entre paquetes.
- **docs/architecture/overview.md**: vista general (menciona pino + Zod para logging/env).

### 2.1 Objetivos de la fase

1. Crear la estructura de monorepo exigida: `apps/api`, `apps/web`, `packages/contracts`, `packages/config`, `packages/database`, `packages/eslint-config` e `infra/docker`.
2. Construir una API NestJS *bootstrap público*: carga y validación de entorno, logging estructurado, correlación (request ID) e health check.
3. Construir una web Next.js + React + TypeScript + Tailwind funcional contra la API.
4. Configurar Prisma 7 sin modelo de negocio (solo infraestructura), con migraciones versionadas listas.
5. Garantizar que Docker ejecute **únicamente** PostgreSQL 17 y Redis 7 con volúmenes persistentes.
6. Mantener separación estricta de variables de entorno (API / Web / Infraestructura).
7. Proveer scripts de operación local y documentación (`docs/infrastructure/local-development.md`, `README.md`).
8. Verificar todo: instalación, infraestructura, build, lint, typecheck y smoke tests.

### 2.2 Fuera de alcance (explicitamente no implementado)

Autenticación y JWT/refresh tokens, RLS multi-tenant, integración WhatsApp, OpenAI/LLM, BullMQ/colas, RAG, productos/clientes/pedidos/servicios/profesionales/reservas, dashboard, billing y despliegues. El modelo de datos se deja intencionalmente vacío.

---

## 3. Requisitos y entorno

| Requisito | Versión usada | Observación |
|---|---|---|
| Node.js | v24.18.0 | `>=24.0.0` declarado en `engines` |
| pnpm | 12.6.0 | No estaba instalado; se instaló global con `npm install -g pnpm@12.6.0` (corepack no disponible). Declarado con `packageManager` |
| Docker Engine | 29.6.1 | Docker Desktop |
| Docker Compose | v5.3.0 | Contenido en Docker Desktop |

El directorio de trabajo reside en OneDrive, lo cual motivó `packageImportMethod: copy` (ver 8.1).

---

## 4. Decisiones de stack y control de versionado

Todas las versiones fueron verificadas contra el registry antes de fijarse. Se priorizó la **estabilidad** sobre el valor `latest` del registry en dos casos críticos.

| Paquete | Versión fijada | Nota técnica |
|---|---|---|
| pnpm | 12.6.0 | Última estable instalada globalmente |
| turbo | ^2.11.3 | Orquestador de tareas |
| TypeScript | 5.9.3 | **No** se usó 7.0.2 (valor `latest` del registry) por ser un cambio mayor reciente |
| NestJS (`@nestjs/common/core/platform-express`) | 12.0.4 | **No** se usó 12.1.0: publicada el mismo día, bloqueada por política de madurez (ver 8.2) |
| `@nestjs/config` | 12.0.1 | — |
| `@nestjs/cli` | 12.0.5 | — |
| Next.js | 16.3.6 | Build con Turbopack |
| React / React DOM | 19.3.0 | — |
| Tailwind CSS | 4.3.3 | Vía `@tailwindcss/postcss` (plugin de PostCSS oficial) |
| Prisma | 7.10.0 | El tag `latest` del registry apunta a un RC (`8.0.0-rc.15`); se eligió la estable 7.x, alineada con ADR-004 |
| `@prisma/client` / `@prisma/adapter-pg` | 7.10.0 | — |
| ESLint | 9.39.5 | Flat config |
| `typescript-eslint` | ^8.70.1 | — |
| `eslint-config-next` | 16.3.6 | Consumido como flat config nativo (ver 8.4) |
| dotenv | ^18.0.3 | Falta de carga de `.env` en Prisma 7 / Next |
| tsx | ^4.23.15 | Ejecución de scripts TS (`db:check`) |

---

## 5. Arquitectura del monorepo

```
negocIA/
├─ apps/
│  ├─ api/         API NestJS (modular monolith)
│  └─ web/         Web Next.js + React + Tailwind
├─ packages/
│  ├─ contracts/   Tipos de wire compartidos (sin dependencias de persistencia)
│  ├─ config/      Validación de entorno y helpers de paths
│  ├─ database/    Schema Prisma, migraciones y factory de PrismaClient
│  └─ eslint-config/ Conjuntos flat de reglas ESLint
├─ infra/
│  └─ docker/      docker-compose.yml (PostgreSQL 17 + Redis 7)
├─ docs/
│  ├─ adr/ ...     ADRs preexistentes
│  ├─ architecture/ ...
│  └─ infrastructure/local-development.md (guía creada en esta fase)
├─ .env.example / .env (raíz; .env gitignored)
├─ pnpm-workspace.yaml
├─ turbo.json
└─ package.json
```

### 5.1 Flujo de dependencias

- `@negocia/api` → `@negocia/config`, `@negocia/contracts`
- `@negocia/database` → `@negocia/config` (para `resolveEnvPath`)
- `@negocia/web` → `@negocia/contracts` (solo contratos; **nunca** importa `@negocia/database`, cumpliendo `dependency-rules.md`)
- `apps/api`, `apps/database` (+ contracts/config) → `@negocia/eslint-config`

Los paquetes compartidos `contracts` y `config` compilan a **CommonJS** (`dist/`) por compatibilidad de interop con NestJS (CJS) y la web (que los resuelve sin problemas vía bundler).

---

## 6. Detalle de implementación por componente

### 6.1 Raíz del monorepo

**`package.json`** — `name: negocia`, `private`, `packageManager: pnpm@12.6.0`, `engines.node >=24`. Scripts de operación:

| Script | Comando |
|---|---|
| `dev` / `build` / `lint` / `typecheck` | `turbo run …` |
| `db:up` / `db:down` / `db:logs` / `db:ps` | `docker compose -f infra/docker/docker-compose.yml …` |
| `db:check` | `pnpm --filter @negocia/database run db:check` |
| `prisma:generate` / `prisma:validate` / `prisma:migrate` / `prisma:deploy` / `prisma:push` / `prisma:studio` | proseguidos a `@negocia/database` |

**`pnpm-workspace.yaml`** — `packages: ["apps/*", "packages/*"]`, `autoInstallPeers: true`, `packageImportMethod: copy` (por OneDrive) y `allowBuilds` (mapeo `{paquete: true}`) para `@prisma/engines`, `@tailwindcss/oxide`, `esbuild`, `prisma` y `unrs-resolver`.

**`turbo.json`** — tareas `build` (`dependsOn: ["^build"]`, outputs `dist/**`, `.next/**`), `dev` (persistent, sin cache), `lint` y `typecheck` (ambas con `dependsOn: ["^build"]`). `globalEnv: ["NODE_ENV"]`.

**`.env.example`** — separación en tres bloques documentados:

| Bloque | Variables |
|---|---|
| API | `NODE_ENV`, `API_HOST=0.0.0.0`, `API_PORT=4000`, `LOG_LEVEL=debug`, `CORS_ORIGINS=http://localhost:3000` |
| Web | `NEXT_PUBLIC_API_URL=http://localhost:4000/api` |
| Infraestructura | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `DATABASE_URL`, `REDIS_PORT`, `REDIS_URL` |

Se copió a `.env` para el entorno local (.env está gitignored).

### 6.2 Infraestructura (`infra/docker/docker-compose.yml`)

- **postgres**: `postgres:17-alpine`, contenedor `negocia-postgres`, healthcheck `pg_isready -U … -d …`, volumen `postgres-data` → `negocia-postgres-data`, puerto `${POSTGRES_PORT:-5432}:5432`, `TZ: UTC`.
- **redis**: `redis:7-alpine`, contenedor `negocia-redis`, `--appendonly yes`, healthcheck `redis-cli ping`, volumen `redis-data` → `negocia-redis-data`, puerto `${REDIS_PORT:-6379}:6379`.
- `restart: unless-stopped`, nombre de proyecto `negocia`, todos los valores con defaults y parametrizados desde `.env` raíz.

### 6.3 `packages/eslint-config`

`type: module`, `exports: { "./*": "./*" }`.

- **`base.js`** (flat config): `globalIgnores` (`node_modules`, `dist`, `.next`, `coverage`, `*.tsbuildinfo`), `js.configs.recommended`, `tseslint.configs.recommended`, regla `consistent-type-imports` (`error`, `inline-type-imports`) y `no-unused-vars` con patrones `^_`.
- **`nestjs.js`**: extiende `base` y desactiva `consistent-type-imports` (razón en 8.3) y `no-extraneous-class`.

### 6.4 `packages/contracts`

Solo tipos, cero dependencias de persistencia. Compila a CJS. Exporta:

- `ApiError` (códigos `VALIDATION_ERROR | AUTHORIZATION_ERROR | NOT_FOUND | CONFLICT | EXTERNAL_PROVIDER_ERROR | LLM_ERROR | DATABASE_ERROR | RATE_LIMIT_ERROR`).
- `ApiEnvelope<T>`, `HealthResponse` (con `requestId?`) y `API_PREFIX = "/api"`.

### 6.5 `packages/config`

- `src/api-environment.ts`:
  - Constantes tipadas: `NODE_ENVS`, `LOG_LEVELS`, defaults de host/puerto/level/CORS.
  - `validateEnv(rawEnv): ApiEnv` — valida `NODE_ENV`, `API_PORT` (entero 1–65535), `LOG_LEVEL` y `CORS_ORIGINS` (no vacío); en errores lanza un `Error` con lista enumerada de motivos.
  - `resolveEnvPath(): string` — resuelve `.env` en la raíz del repo usando `INIT_CWD` (variable que pnpm establece con el directorio de invocación) con fallback a `process.cwd()`.
- `src/index.ts` re-exporta todo.
- Build CJS a `dist/`.

### 6.6 `packages/database`

- **`prisma/schema.prisma`** — generator `client` (`provider = "prisma-client"`, `output = "../src/generated/prisma"`, `moduleFormat = "cjs"`) y datasource `postgresql` sin URL (la provee el config). **Sin modelos**: solo infraestructura, con comentario indicando que el modelo de negocio llega en fases posteriores vía migraciones.
- **`prisma.config.ts`** — `defineConfig` (Prisma 7): carga `.env` raíz con dotenv (misma lógica `INIT_CWD`), `schema`, `migrations.path = prisma/migrations` y `datasource.url` desde `DATABASE_URL` con default local.
- **`src/index.ts`** — singleton `prisma`: `loadDotenv({ path: resolveEnvPath() })`, adapter `PrismaPg({ connectionString })` (patrón client-adapter de Prisma 7 con `node-postgres`), caching del cliente en `globalThis` fuera de producción y re-exportación del cliente generado.
- **`src/scripts/check.ts`** — `$connect()` + `$queryRaw<Array<{result: number}>>` `SELECT 1 AS result`; imprime `[db:check] PostgreSQL connection OK -> [...]`, cierra con `$disconnect`.
- Scripts: `build` (`prisma generate --no-hints && tsc`), `generate`, `validate`, `migrate:dev`, `migrate:deploy`, `push`, `studio`, `db:check` (tsx) y `typecheck`.

### 6.7 `apps/api` (NestJS)

**package.json**: dependencias `@nestjs/common/core/platform-express` (12.0.4), `@nestjs/config` 12.0.1, `reflect-metadata`, `rxjs`, `@negocia/config`, `@negocia/contracts`. Dev: `@nestjs/cli` 12.0.5, `@types/express`, eslint, TS 5.9.3. Scripts: `dev` (`nest start --watch`), `build` (`nest build`), `start` (`node dist/main.js`).

`tsconfig.json` (común de Nest): `module: commonjs`, `moduleResolution: node10`, target/lib ES2022, decoradores, `strict: true`, incremental.

- **`src/main.ts`**
  1. Importa `reflect-metadata` y crea la app con `logger: new StructuredLogger()`.
  2. Lee `ConfigService<ApiEnv, true>`.
  3. `setGlobalPrefix("api")` (coincide con `API_PREFIX` de contracts).
  4. `enableCors` con `origin` desde `CORS_ORIGINS`, `credentials`, métodos y headers permitidos (incluye `X-Request-Id`).
  5. `enableShutdownHooks()`.
  6. Escucha en `API_HOST`/`API_PORT`.
- **`src/app.module.ts`** — `ConfigModule.forRoot({ isGlobal, envFilePath: resolveEnvPath(), cache, validate: validateEnv })`; importa `CorrelationModule` y `HealthModule`.
- **`common/correlation/`** — `AsyncLocalStorage<CorrelationContext>` (`async-context.ts`); middleware `CorrelationIdMiddleware` que lee el header `x-request-id` o genera `randomUUID()`, lo fija como response header y ejecuta el resto de la pila dentro del contexto (`correlation-id.middleware.ts`); `CorrelationService` lee el id actual. `CorrelationModule` aplica el middleware a `*` y exporta el servicio.
- **`common/logger/structured-logger.ts`** — `StructuredLogger implements LoggerService` que emite una línea JSON por registro: `{ level, timestamp, service: "negocia-api", message, context?, stack?, meta?, requestId? }`, con redirección por nivel (`console.error/warn/log`). Normaliza parámetros opcionales al estilo Nest (contexto y stack) y agrega `requestId` desde el contexto de correlación cuando existe.
- **`modules/health/`** — `HealthModule` importa `CorrelationModule`; `HealthController` expone `GET /health` (con el prefijo global queda **`GET /api/health`**) y retorna `HealthResponse` construida por `HealthService` (status, service, version desde `npm_package_version`, environment, timestamp ISO, uptime en segundos y `requestId` si existe).

### 6.8 `apps/web` (Next.js 16 + React 19 + Tailwind 4)

- **`next.config.ts`** — carga `.env` raíz con dotenv (`INIT_CWD` con fallback a `cwd()`) y exporta `NEXT_PUBLIC_API_URL` (default `http://localhost:4000/api`) para que esté disponible en el bundle.
- **`app/layout.tsx`** — `metadata` (título/descripción), `<html lang="es">`, cuerpo con clases Tailwind.
- **`app/page.tsx`** — página de inicio "fundation": header, tarjetas de servicios (API, Web, PostgreSQL, Redis) y componente `ApiStatus`, footer con la URL de API detectada en build.
- **`components/api-status.tsx`** — componente `"use client"`: consulta `${NEXT_PUBLIC_API_URL}/health` con `fetch`, tipado contra `HealthResponse` de `@negocia/contracts`, con estado `loading | ok | error` y guard de cancelación en `useEffect`.
- **`app/globals.css`** — `@import "tailwindcss";`.
- **`postcss.config.mjs`** — plugin `@tailwindcss/postcss`.
- **`eslint.config.mjs`** — flat config consumiendo `eslint-config-next/core-web-vitals` y `next/typescript` directamente como arrays planos (ver 8.4), ignores y `consistent-type-imports`.

### 6.9 Documentación

Se crearon `docs/infrastructure/local-development.md` (guía de clonado → instalación → infraestructura → build → desarrollo → health) y el `README.md` raíz.

---

## 7. Modelo de datos (estado deliberado)

El schema Prisma **no contiene modelos** en esta fase. Esto se decidió intencionalmente: la fundación valida que Prisma 7, el cliente generado y la conexión funcionan de extremo a extremo sin arrastrar decisiones de dominio aún no validadas. Los ADRs (tenant-context + RLS, auth JWT con rotación, planes/límites, invitaciones) y `docs/database/schema.md` definen el rumbo para las siguientes fases.

---

## 8. Incidentes y resoluciones técnicas

### 8.1 Scripts de build bloqueados por pnpm 12

**Síntoma**: `ERR_PNPM_IGNORED_BUILDS` — pnpm bloquea por defecto los *postinstall* de dependencias (`@prisma/engines`, `esbuild`, etc.).

**Causa raíz**: en pnpm 12 el campo `"pnpm"` de `package.json` **ya no se lee**; la configuración vive en `pnpm-workspace.yaml`. Además, `allowBuilds` acepta un **mapeo** `{paquete: true}`, no una lista (una lista causaba error de parseo YAML). El puesto con listas de la forma anterior quedó obsoleto.

**Resolución**: se definieron los cinco paquetes en `allowBuilds` dentro de `pnpm-workspace.yaml`. El `.npmrc` se dejó sin contenido (solo aplica a auth/registry).

### 8.2 Política de madurez de publicación (`minimumReleaseAge`)

**Síntoma**: `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` al instalar `@nestjs/…@12.1.0`.

**Causa**: existe una política global de supply-chain en pnpm que rechaza paquetes publicados dentro de una ventana (cutoff `2026-09-23T00:51Z`). `@nestjs/common/core/platform-express@12.1.0` se publicaron el 23/09/2026 y quedaron dentro de la ventana.

**Resolución**: se fijaron a **12.0.4** (publicado el 21/09) en `apps/api/package.json`, junto a `@nestjs/config@12.0.1` y `@nestjs/cli@12.0.5`.

### 8.3 Lockfile obsoleto tras fijar versiones

**Síntoma**: tras el cambio a 12.0.4, `pnpm install` seguía fallando — el mensaje indicaba que **3 entradas del lockfile** (`@nestjs/…@12.1.0`) no pasaban la verificación.

**Causa**: `pnpm-lock.yaml` contenía snapshots de la resolución anterior y no se regeneraba con los downs de versión.

**Resolución**: `pnpm clean --lockfile` (borra `node_modules` de todos los workspaces y el lockfile) y nuevo `pnpm install`. Resultado: `Packages: +653`, `Done in 4m 11.8s`, con los *postinstall* permitidos ejecutándose correctamente.

### 8.4 Daemon de Docker no iniciado

**Síntoma**: `docker compose up` → `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.

**Resolución**: se lanzó `Docker Desktop.exe` y se hizo polling de `docker info` (esperando `Server Version = 29.6.1`) antes de continuar.

### 8.5 Lint de la API: `consistent-type-imports` rompía la DI

**Síntoma**: 3 errores en `apps/api` — `@typescript-eslint/consistent-type-imports` exigía `import type` para `MiddlewareConsumer` y para `HealthService`/`CorrelationService`.

**Causa**: en clases decoradas, NestJS resuelve dependencias mediante `emitDecoratorMetadata`, que emite referencias de **módulo real** en `design:paramtypes`; convertir esos imports a *solo tipo* rompería la inyección en runtime.

**Resolución**: en `packages/eslint-config/nestjs.js` se desactiva `consistent-type-imports` (documentando el motivo) y `no-extraneous-class`; en `correlation.module.ts` se usó import inline `import { Module, type MiddlewareConsumer, type NestModule }`.

### 8.6 Web lint: crash circular con `FlatCompat`

**Síntoma**: `TypeError: Converting circular structure to JSON` en `@eslint/eslintrc@3.3.7` (`config-validator.js`) al cargar `eslint-config-next/core-web-vitals` con `FlatCompat`.

**Causa raíz (investigada)**: `eslint-config-next@16` **ya no publica una config legacy**; `dist/core-web-vitals.js` y `dist/typescript.js` son **arrays de flat config** (`module.exports = [...indexConfig, pluginConfigs]`) con objetos de plugins en `plugins`. `FlatCompat` es un wrapper del cargador legacy de `@eslint/eslintrc`; al recibir un array flat, el validador de esquema falla e intenta `JSON.stringify` del objeto que contiene referencias circulares (`configs.flat.plugins.react`) → crash.

**Resolución**: el flat config de la web importa directamente los arrays: `import coreWebVitals from "eslint-config-next/core-web-vitals"` y `import nextTypeScript from "eslint-config-next/typescript"`, desplegándolos en el export. Se eliminó `@eslint/eslintrc`, `eslint-config-next` como dependencia interna de `packages/eslint-config` y el consumo de `@negocia/eslint-config` en web (ya no usa el config compartido; usa el flat nativo de Next). El warning residual `import/no-anonymous-default-export` se resolvió asignando el array a `const eslintConfig` antes del export.

### 8.7 Next build reconfigura `tsconfig.json`

Durante `next build`, Next ajustó automáticamente: `jsx: react-jsx` y añadió `.next/dev/types/**/*.ts` al `include`. Cambio esperado y documentado por Next.

---

## 9. Verificaciones y evidencia

### 9.1 Instalación

```
Packages: +653
.../node_modules/@prisma/engines postinstall ... Done
.../node_modules/esbuild@0.28.2/node_modules/esbuild postinstall ... Done
.../node_modules/unrs-resolver postinstall ... Done
.../node_modules/prisma preinstall ... Done
Done in 4m 11.8s using pnpm v12.6.0
```

### 9.2 Infraestructura

```
NAME               IMAGE                SERVICE    STATUS
negocia-postgres   postgres:17-alpine   postgres   Up About a minute (healthy)
negocia-redis      redis:7-alpine       redis      Up About a minute (healthy)
```

Prisma de extremo a extremo:

```
[db:check] PostgreSQL connection OK -> [{"result":1}]
PONG   (redis-cli ping dentro del contenedor)
```

Prisma client/schema:

```
✔ Generated Prisma Client (7.10.0) to .\src\generated\prisma in 22ms
The schema at prisma\schema.prisma is valid
```

### 9.3 Build (Turborepo)

`pnpm build` → `Tasks: 5 successful, 5 total | Time: 48.638s`. Incluye `nest build` (API), `next build` con Turbopack (web: compilación en ~22s, TypeScript en 3.1s, 3 páginas estáticas), `tsc` (contracts/config) y `prisma generate --no-hints && tsc` (database).

### 9.4 Typecheck

`pnpm typecheck` → `Tasks: 8 successful, 8 total | Time: 5.054s`.

### 9.5 Lint

`pnpm lint` → `Tasks: 8 successful, 8 total | Time: 7.142s`, tras corregir 8.3 y 8.5.

### 9.6 Smoke tests

API (arrancada con `pnpm --filter @negocia/api start`; `node dist/main.js`) — `GET http://localhost:4000/api/health`:

```json
{"status":"ok","service":"negocia-api","version":"0.0.0","environment":"development",
 "timestamp":"2026-09-24T01:08:51.206Z","uptime":17,
 "requestId":"73fadf24-417e-486a-99de-e174cef2e613"}
```

Web (arrancada con `pnpm --filter @negocia/web start`; `next start`) — `GET http://localhost:3000` devolvió `200` con HTML (`<html lang="es">` y bundles de `/_next/static/chunks`).

---

## 10. Procedimientos operativos (guía rápida)

```bash
pnpm install                 # instala todo el workspace
pnpm db:up                   # levanta PostgreSQL 17 + Redis 7
pnpm db:ps                   # estado de los contenedores
pnpm db:check                # verificación SELECT 1 a PostgreSQL
pnpm prisma:generate         # genera el cliente Prisma
pnpm build                   # build topológico completo
pnpm lint && pnpm typecheck  # calidad
pnpm dev                     # API (:4000) + web (:3000) en watch
```

Más detalle en `docs/infrastructure/local-development.md`.

---

## 11. Decisiones arquitectónicas (resumen)

1. **Monorepo pnpm + Turborepo** (ADR-003), modular monolith (ADR-001), PostgreSQL como fuente de verdad (ADR-002) y Prisma 7 + escape de SQL crudo (ADR-004).
2. **Versiones "conservadoras"**: se rechazan `latest` inmaduros del registry (TypeScript 7.0.2, Prisma 8 RC) y publicaciones dentro de la ventana de madurez de pnpm (NestJS 12.1.0).
3. **`.env` único en la raíz**, cargados por cada consumidor (API vía `@nestjs/config` + `validateEnv`; database vía `prisma.config.ts`; web vía `next.config.ts`), con resolución robusta por `INIT_CWD`.
4. **Logging estructurado con `StructuredLogger` propio** (JSON por línea + `requestId` vía `AsyncLocalStorage`) en lugar de pino/serializers — `docs/architecture/overview.md` los sugiere, pero la restricción de minimizar dependencias prevaleció; el adaptador es un reemplazo trivial si más adelante se requiere pino.
5. **Correlación por request id** como middleware global con contexto asíncrono y contrato `x-request-id`.
6. **Contratos entre API y web** (`@negocia/contracts`) para tipar el wire; **prohibida** la importación de persistencia desde web (`dependency-rules.md`).
7. **Prisma sin modelos en la fundación**: se valida la infraestructura antes de fijar el dominio.
8. **Flat config nativo de `eslint-config-next`** v16 (no `FlatCompat`), evitando el crash documentado en 8.6.
9. **CORS y prefijo `/api`** parametrizados por entorno para desarrollo.
10. **Infraestructura reproducible** con healthchecks, volúmenes nombrados y puertos configurables vía `.env`.

---

## 12. Trabajo futuro recomendado

1. ~~Definición del modelo de datos inicial y primera migración~~ → **Ejecutado**, ver §13 (Fase 1: `identity-core`). Continuar con la infraestructura de API común y auth (M-2/M-3/M-4).
2. **Health check extendido** con dependencias (PostgreSQL, Redis) en el módulo `health`, reutilizando `@negocia/database`.
3. ~~**Auth**~~ → **Ejecutado en M-4/M-5**: JWT + refresh rotation (ADR-005), invitaciones/verificación (ADR-008) y contextos de tenant, ver §13.7 y §13.8.
4. **Integraciones externas**: WhatsApp y proveedores de LLM (capas aisladas como módulos; `ApiError` ya contempla `EXTERNAL_PROVIDER_ERROR` / `LLM_ERROR` / `RATE_LIMIT_ERROR`).
5. **Colas** (BullMQ sobre Redis) cuando aparezcan procesos asíncronos.
6. **Dashboard inicial** e incorporación de planes/límites (ADR-007).
7. Adopción de pino+Zod si el nivel de observabilidad lo exige (revisar restricción de dependencias).

---

## 13. Continuación — Fase 1: modelo de identidad (`identity-core`)

### 13.1 Alcance ejecutado (24/09/2026)

Se materializó el **primer paso de la Fase 1** (identidad) del MVP: el modelo de datos de `docs/database/schema.md` y su migración versionada.

| Ítem | Detalle |
|---|---|
| Schema | `packages/database/prisma/schema.prisma` con 6 modelos: `Tenant`, `User`, `Membership`, `RefreshToken`, `Invitation`, `VerificationToken` |
| Migración | `prisma/migrations/20260924012558_identity_core/migration.sql` (generada con `migrate dev --create-only` y luego **editada a mano** para el SQL raw de invariantes) |
| enums | `text` + **CHECK** (no enums nativos de PG): `tenants.plan`, `tenants.status`, `users.status`, `memberships.role/status`, `invitations.role/status` |
| Invariantes SQL raw | paridad `(accepted_at IS NULL) = (accepted_by IS NULL)`; partial unique `(tenant_id, email) WHERE status='PENDING'`; índice parcial `refresh_tokens(user_id) WHERE revoked_at IS NULL`; índice `users(lower(email))` (fallback de citext, `schema.md §4`) |
| IDs | `gen_random_uuid()` generado en BD (`@default(dbgenerated(...))`, nativo en PG17) |
| FKs | `memberships.tenant` RESTRICT / `memberships.user` CASCADE; `invitations.tenant` CASCADE, `invited_by` RESTRICT, `accepted_by` SET NULL; `refresh_tokens/verification_tokens.user` CASCADE; self-FK `RefreshToken.replacedBy` SET NULL (familias de refresco) |
| Timestamps | `timestamptz`; `created_at` con `DEFAULT now()`, `updated_at` gestionado por aplicación (`@updatedAt`), sin triggers (`schema.md §9.2`) |
| Tags de no bind | emails compilados a `text + UNIQUE + lower()` en vez de `citext` para evitar drift Prisma↔citext; la normalización lowercase/trim queda en la capa de aplicación (M-4) |

### 13.2 Verificaciones (todas en verde)

- `prisma migrate dev` aplicó la migración; `prisma migrate status` → `Database schema is up to date!`.
- PostgreSQL: 6 tablas creadas + `_prisma_migrations`; 8 CHECKs y los 3 índices especiales confirmados en `information_schema`/`pg_indexes`.
- `prisma validate` → schema válido; `db:check` → `PostgreSQL connection OK`.
- Cliente Prisma regenerado con los 6 modelos; `pnpm build` (5/5), `pnpm typecheck` (8/8) y `pnpm lint` (8/8) sin errores.

### 13.3 Decisiones registradas (M-1)

1. **Enums como text + CHECK** (no `CREATE TYPE ... enum`): evolucionar un `status` futuro (p. ej. agregar `TRIAL`) es un `DROP/ADD CONSTRAINT`, no un `ALTER TYPE` con bloqueos; fiel a `schema.md`.
2. **Email como `text` + UNIQUE + índice `lower(email)`** en vez de `citext`: es el fallback explícitamente permitido por `schema.md §4`; evita la extensión y el drift de tipos Prisma↔PostgreSQL. La unicidad case-insensitive queda garantizada por el índice, no solo por normalización.
3. **`@updatedAt` de Prisma** para `updated_at`: consistente con la decisión de "actualizar `updated_at` en aplicación, sin triggers" (`schema.md §9.2`). Nota: `updateMany` no dispara `@updatedAt`; si se usa, se setea explícitamente.
4. **`RefreshToken.replacedById` marcado `@unique`**: modela la cadena de rotación como 1-a-1 (un token solo puede ser reemplazado una vez), prerequisito para la detección de reuse (ADR-005).

### 13.4 Próximo paso (M-2) — ejecutado, ver §13.5

Infraestructura de API común (ValidationPipe global + `class-validator`, exception filter → `ApiError`, Swagger/OpenAPI, rate limiting) antes de los módulos de dominio/auth. Librerías ya decididas: `jose` + `argon2` + `class-validator` + `@nestjs/swagger` + `@nestjs/throttler`; env config con `validateEnv` actual (extendido); tests con **Vitest**.

### 13.5 Checkpoint — M-2 ejecutado (24/09/2026): infraestructura de API común

| Área | Implementado |
|---|---|
| `packages/contracts` | `ApiError.code` → **catálogo canónico snake_case** (22 códigos, `API_ERROR_CODES`); `ApiError.requestId?`; nuevo `ListResponse<T>`. *Una desviación registrada: la regla dependency-rules.md:34 dice "el ENV usa Zod" y mantenemos `validateEnv` (decisión previa), a reconciliar.* |
| `apps/api` domain | `src/domain/errors`: `AppError` (base, sin deps de framework) + `Validation/Authentication/Authorization/NotFound/Conflict/RateLimit/ExternalProvider/Llm/Database/InternalServerError`; tipo `DomainErrorCode` (mismo catálogo que contracts; el cast se valida en el filter) |
| Exception filter | `src/common/filters/all-exceptions.filter.ts`, global vía `APP_FILTER`; mapea `AppError`→status/código, `HttpException`→código por status (400→validation_error…), desconocidos→500 `internal_server_error`; inyecta `requestId` del contexto de correlación; loguea por severidad (warn/error) con path, código y stack; sin stack traces al cliente |
| Validación | `ValidationPipe` global en `main.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`) |
| Swagger | `src/common/swagger/swagger.setup.ts`; UI en `GET /api/docs` + spec `GET /api/docs-json` con securityScheme `bearer`; plugin `@nestjs/swagger` en `nest-cli.json` |
| Rate limiting | `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])` global (`APP_GUARD`); `@SkipThrottle()` en `HealthController` |
| Dependencias | `class-validator@^0.15.1`, `class-transformer@0.5.1`, `@nestjs/swagger@12.0.1` (12.0.2 bloqueada por `minimumReleaseAge`, publicada hoy), `@nestjs/throttler@^6.7.0` |
| Incidente pnpm | `@scarf/scarf` (postinstall de `@nestjs/swagger`) bloqueó la instalación → movido a `allowBuilds: true` en `pnpm-workspace.yaml` (postinstall de telemetría benigno en dev) |

Verificaciones (en verde): `pnpm build` 5/5, `pnpm typecheck` 8/8, `pnpm lint` 8/8. Smoke tests en local:

- `GET /api/health` → `200` JSON con `requestId`.
- `GET /api/no-existe` → `404` `{"code":"not_found","message":...,"requestId":...}` + header `x-request-id`.
- `GET /api/docs` → `200` Swagger UI; `GET /api/docs-json` → `200` con `securitySchemes.bearer`.

Nota: el throttle `429` no se validó funcionalmente porque el `ThrottlerGuard` solo corre contra rutas existentes y el único endpoint real (`/api/health`) está `@SkipThrottle()`. **Resuelto en M-4**: el `429` se verifica en la suite e2e contra el límite de registro (`test/auth.e2e-spec.ts` → "registro repetido acaba en 429").

### 13.6 Checkpoint — M-3 ejecutado (24/09/2026): puertos de dominio y reglas puras

| Área | Implementado |
|---|---|
| Tests | **Vitest** (runner elegido): `vitest.config.mts` (ESM, sin warning de native config loader), script `test: "vitest run"`, specs co-locadas en `src/**/*.spec.ts` (excluidos del `dist` por `tsconfig.build.json`) |
| Puertos | `src/domain/ports` (interfaces puras, sin deps externas): `PasswordHasher`, `EmailSender` (+`EmailMessage` con `token?`/`expiresAt?`), `TokenHasher` |
| Adapters | `src/infrastructure`: `MockPasswordHasher`, `MockEmailAdapter` (buffer `sent[]`), `Sha256TokenHasher` (**definitivo**, SHA-256 hex via crypto) |
| Planes/Límites | `src/domain/plans`: `PlanCatalog` con claves `BASIC\|PRO\|PREMIUM` (enum real del schema), `DEFAULT_PLAN=BASIC`; `LimitsService.assertUnderLimit` (semántica `>=`, lanza `ConflictError` con details) — ADR-007 |
| Dominio sesión | `src/domain/session/refresh-session.ts`: `classifyRefreshLookup` (5 branches: not_found→invalid, revoked→reuse, expired→invalid, replaced→reuse, active→rotate) + `computeTokenExpiry` — fiel a `authentication.md §5` |
| Doc fix | `fases/M1-modelo-identidad.md`: enum de plan `STARTER\|BASIC\|GROW` → `BASIC\|PRO\|PREMIUM` (CHECK real en `migration.sql:166`) |

Verificaciones (en verde): `pnpm --filter @negocia/api test` → **5 files / 23 tests passed**; `pnpm build` 5/5; `pnpm typecheck` 8/8; `pnpm lint` 8/8.

Incidencias: (1) aserción de límite contra plan resuelto inicialmente errada (se corrigió el test, no el comportamiento); (2) vector SHA-256 inventado sustituido por digest real calculado (regla: nunca inventar vectores criptográficos); (3) `vitest.config.ts` CJS→`.mts` por warning de Vite; (4) lint `no-unused-vars` (`Plan` import no usado). Detalle completo en `fases/M3-puertos-dominio-reglas-puras.md`.

### 13.7 Checkpoint — M-4 ejecutado (29/09/2026): auth y contexto de tenant

| Área | Implementado |
|---|---|
| Migración | `20260929210324_refresh_token_session_id`: `refresh_tokens.session_id` y `tenant_id` `NOT NULL` + índices (incluido parcial `WHERE revoked_at IS NULL`); backfill que ancla cada fila a la raíz de su familia y, con multi-dispositivo, se auto-ancla en lugar de fusionar sesiones; sin FK a propósito (el tenant se cierra con `status=CLOSED`, no se borra) |
| Puertos | `AccessTokenIssuer`, `IdGenerator`, `RefreshTokenRepository`, `UnitOfWork` + repositorios de `User/Tenant/Membership/VerificationToken`; `ID_GENERATOR` en `di-tokens` mantiene la aplicación sin imports de infrastructure |
| Seguridad | `Argon2PasswordHasher` (argon2id 19 MiB / t=2 / p=1, mínimos OWASP; `verify` devuelve `false` ante hash corrupto), `JwtAccessTokenIssuer` (HS256 **constante en código**, `typ: "JWT"`, claims mínimos `sub/jti/tenant_id/iss/aud/iat/exp`), `CryptoOpaqueTokenGenerator`, `Sha256TokenHasher` |
| Refresh | Rotación atómica: sucesor con el mismo `session_id` y `tenant_id`, revocación condicional del predecesor, rollback ante carrera, `reuse_detected` + revocación de la familia completa; `jti` = `session_id` de la familia |
| Guards | Cadena global `ThrottlerGuard → JwtAuthGuard → TenantContextGuard → RolesGuard`; `TenantContextInterceptor` abre el `AsyncLocalStorage` **después** de los guards; `RolesGuard` lee `request.principal` |
| HTTP | `POST /api/v1/auth/{register,login,refresh,logout,revoke-all,switch-tenant}` y `GET /api/v1/me`; rate limits por ruta; login no enumera cuentas; DTOs con `whitelist` + `forbidNonWhitelisted` |
| Versionado | `app.enableVersioning({ type: URI, defaultVersion: "1" })` en `main.ts`; `HealthController` con `@Version(VERSION_NEUTRAL)` para no desplazar `/api/health`, que ya estaba publicado en el `.env` del front y en la documentación |
| Env | `JWT_SECRET` obligatoria en **todos** los entornos con el mismo mínimo de 32 bytes que aplica `JwtAccessTokenIssuer` (antes solo en production, lo que dejaba un arranque limpio que reventaba en el primer login) |
| Tests | Suite de integración contra PostgreSQL real (`vitest.integration.config.mts`, `schema=negocia_test` vía `DROP SCHEMA` + `migrate deploy`) y suite e2e HTTP con Supertest sobre la app completa (`vitest.e2e.config.mts`), ambas en serie por compartir schema |

Verificaciones (en verde): `pnpm lint` 9/9; `pnpm typecheck` 9/9; `pnpm build` 5/5; `pnpm test` → **10 files / 102 tests**; `pnpm test:integration` → **1 file / 17 tests**; `pnpm test:e2e` → **1 file / 27 tests**; `pnpm db:check` OK. Scripts nuevos en la raíz: `test`, `test:integration`, `test:e2e` y `verify`.

Incidencias: (1) `AuthConfigService` importado con `import type` rompía el DI en runtime; (2) `RolesGuard` leía el rol del ALS en vez de `request.principal`; (3) `ThrottlerGuard` llevaba tiempo sin servicio de contexto, con el limitador inactivo; (4) el e2e, al compartir una sola instancia de Nest, heredaba contadores de throttler entre tests — se vacían en `beforeEach`; (5) `enableVersioning` desplazaba `/api/health` a `/api/v1/health`; (6) `@IsEmail()` rechazaba emails con espacios que `normalizeEmail` sí normaliza — se añadió `@Transform` de `trim`. Detalle completo en `fases/M4-auth-tenant-context.md`.

### 13.8 Checkpoint — M-5 ejecutado (30/09/2026): invitaciones, verificación de email, tenants y usuarios

Cierre de la Fase 1. Los contratos vivían en `docs/api/authentication.md` §7–§10 desde la escritura del diseño; este hito los materializó en código:

| Área | Implementado |
|---|---|
| Invitaciones | `POST /v1/invitations` (`@Roles(OWNER, ADMIN)`, 201, throttle 30/h, token **solo en el email** y hasheado en BD, `INVITATION_TTL_SECONDS` 48 h, expiración perezosa, revalidación de `LimitsService.assertUnderLimit` al aceptar —ADR-007—, traducción de `P2002`→409); `POST /v1/invitations/accept` (autenticado, emite sesión vía `SessionService`, un solo `invalid_token` para inválido/usado/vencido/de otro email); `DELETE /v1/invitations/:id` (204, 404 sin distinguir "no existe" de "de otro tenant", 409 si no `PENDING`) |
| Verificación de email | `POST /v1/email-verification/verify` (token 1-uso, `VerifyOutcome` commitea el consumo del vencido antes de lanzar) y `POST /v1/email-verification/resend` (invalida pendientes, throttle 5/15 min); `verify` system-scoped —el token es la prueba, se permite el caso multi-dispositivo— |
| Tenants | `GET/PATCH /v1/tenants/current` (GET sin `@Roles`; PATCH `@Roles(OWNER)`, edita `name`/`slug`, `plan`/`status` no editables) y `GET/PATCH /v1/tenants/:tenantId/users` (GET sin rol "agenda del equipo"; PATCH `@Roles(ADMIN)` jerárquico, ADMIN no toca OWNER → 403, `:tenantId` ≠ token → 404 `NotFoundError`, nunca 403) |
| Último OWNER | `MembershipRepository.lockActiveOwners` → `SELECT … FOR UPDATE` sobre `role='OWNER' AND status='ACTIVE'` (`$queryRaw` con cast a `Prisma.TransactionClient`), re-conteo `countActiveOwners` en la misma transacción → 409 si `<= 1`; cierra la carrera de dos OWNER degradándose a la vez (READ COMMITTED) |
| Slug | `UpdateTenantDto.slug` con `^[a-z0-9]+(?:-[a-z0-9]+)*$` min 3 max 60: el cliente manda el slug normalizado (400 si no); `slugify()` queda como defensa del servicio; slug ocupado → 409 |
| DI | `TenantService` con `@Inject(TENANT_REPOSITORY)` (2º caso de la lección M-4: interfaz en el último parámetro rompe la reflexión de Nest; usar el token y el import **como valor**) |
| Paridad de errores | `DOMAIN_ERROR_CODES` runtime en `apps/api/src/domain/errors/app-error.ts` + `app-error.spec.ts` comparando contra `API_ERROR_CODES` real de `@negocia/contracts` (no transcripción) |
| CI / runbook | `.github/workflows/ci.yml` (Postgres 16 service con health check, pnpm 12.6.0 frozen-lockfile, Node 24, `JWT_SECRET` de prueba, `pnpm verify`); raíz `package.json` `verify` → `lint && typecheck && build && test && test:integration && test:e2e && db:check` |

Verificaciones (en verde, `pnpm verify` completo): `pnpm lint` 9/9; `pnpm typecheck` 9/9; `pnpm build` 5/5 (incl. `next build` 16.3.6); `pnpm test` → **17 files / 169 tests** (api) + **11** (contracts); `pnpm test:integration` → **4 files / 36 tests**; `pnpm test:e2e` → **4 files / 78 tests**; `pnpm db:check` OK.

Incidencias: (1) `"role" in change` roto en `updateUser` porque la variante unaria expone `value` → dispatcher por `change.kind`; (2) la carrera del último OWNER era intermitente en integración hasta cerrarla con el lock FOR UPDATE; (3) el e2e de 3 miembros exigía `plan=PRO` (BASIC `maxUsers=2`) → se actualiza por DB en el test; (4) `membership-status.ts` duplicaba `statuses.ts` → eliminado, `statuses.ts` es la fuente única; (5) `ApiProperty` sin usar en `tenant-input.dto.ts` → import eliminado. Detalle completo en `fases/M5-cierre-fase-1.md`.

### 13.9 Próximo paso — Fase 2: integraciones externas

WhatsApp y proveedores LLM (item 4 de §12), como módulos aislados sobre los códigos de error que ya existen (`external_provider_error`, `llm_error`). En paralelo: un proveedor de email real para sustituir `MockEmailAdapter`, la plantilla de email (ADR-008), y el onboarding web/dashboard sobre `@negocia/contracts`.