# M7 — Fase 2: canal de entrada WhatsApp Cloud API (webhook + cola + worker)

| Campo | Valor |
|---|---|
| Fase | 2 (canal de mensajería entrante / F2-3) |
| Fecha | 03/10/2026 |
| Estado | **Completo** en código y verificación de suites |
| Referencias normativas | ADR-010, `docs/architecture/whatsapp.md`, `docs/api/webhooks.md`, `docs/database/schema.md` §10, `docs/pendiente-fase-2.md`, Q4 de `PROJECT_CONTEXT.md` §19 |

## 1. Contexto y objetivo

El producto vende asistencia por WhatsApp: el canal **entrante** (webhook de Meta) es el primer
piso de negocio. Este hito lo entrega como ingestión pura — responder 200 a Meta a tiempo es el
contrato de no-intento de un webhook — con idempotencia real en dos capas y el procesamiento en
un proceso worker separado (BullMQ/Redis). De paso cierra Q4 (`PROJECT_CONTEXT` §19): Redis deja
de ser infra "muerta" (primer consumidor real: la cola) y el readiness pasa a sondear PG+Redis.

Decisiones de producto tomadas en sesión (recomendadas y aprobadas):

1. **Sin credenciales reales de Meta:** `META_DRIVER=mock` (default), bloqueado en producción,
   mismo patrón que `EMAIL_DRIVER`.
2. **Embedded Signup diferido a M9:** en M7 el alta de cuentas es **manual** (OWNER registra
   `waba_id` + `phone_number_id` + `access_token`).
3. **Worker probe:** el worker de M7 solo consume y marca `PROCESSED`; el LLM y la resolución de
   negocio quedan para F2-4/F3-x (ADR-001: worker = proceso separado del mismo `apps/api`).

### Criterios de done

1. Webhook GET/POST validado por firma HMAC-SHA256 (`rawBody`), `@HttpCode(200)` explícito,
   dedup por UNIQUE `provider_event_id` + enqueue BullMQ (`jobId = providerEventId`).
2. Alta manual de cuentas (OWNER) con doble UNIQUE por tenant → 409; `access_token` nunca en respuestas.
3. Worker separado (`pnpm start:worker`) con concurrency 5; `WhatsappEventQueuer` + repos idempotentes (updateMany con status previo en el `where`).
4. Health `ready()` agrega `DEPENDENCY_PROBES` (postgres + redis) sin filtrar DSN/contraseñas (solo clase del error).
5. `REDIS_URL` obligatoria + vars `META_*` en `validateEnv`; `webhook_verification_failed` en ambos catálogos de `contracts`.
6. Suites unit / integración / e2e en verde + lint + typecheck + `db:check` OK.

Fuera de alcance: Embedded Signup (M9), envío real (M9), procesamiento de negocio
en el worker, SDK de Meta, jobs de mantenimiento/limpieza de cola y `dev:worker`.

## 2. Decisión de diseño

Ver ADR-010 (webhook = ingestión; cola con `jobId`; worker probe) y `docs/architecture/whatsapp.md`.

- **Firma:** `infrastructure/whatsapp/meta-webhook-signature.ts` — HMAC-SHA256 del body crudo
  comparada en tiempo constante (header con o sin `sha256=`); `isHubSubscribeRequest` y
  `hubChallenge` para el handshake GET (challenge **text/plain**, no JSON wrapper).
- **Ingestión (`WhatsAppWebhookService.ingest(input: unknown)`):** guards estructurales
  (`isRecord`, `Array.isArray`), cuenta resuelta por `phone_number_id`; payload para tenant no
  registrado → ignored (200, sin fila); `create` con UNIQUE (carrera → `null`); enqueue falla →
  `markFailed` + `ExternalProviderError` (502, retryable).
- **Estados:** `RECEIVED|ENQUEUED|PROCESSED|FAILED|DEDUPLICATED`; `RECEIVED/FAILED` retryable,
  `ENQUEUED/PROCESSED/DEDUPLICATED` no-op. JSON malformado → 200 con reporte vacío (no bucles de
  Meta). `@Throttle` 600/60s propio.
- **Cuentas:** `POST/GET /v1/whatsapp/accounts` solo OWNER; DTO con `!` (class-validator),
  mapper que excluye `accessToken`; duplicados → `ConflictError` vía `translatePrismaError` (409).
- **Cola/worker:** `BullWhatsappEventQueue` con instancia ioredis (`maxRetriesPerRequest: null`,
  `attempts: 3`, backoff 2s, `removeOnComplete: 1000`, `removeOnFail: 5000`); worker lee
  `worker/main.ts` → `WorkerModule` (`ConfigModule` validate + `DatabaseModule`); SIGINT/SIGTERM
  cierran el app context.
- **Health/Q4:** `HealthService` inyecta `DEPENDENCY_PROBES` (factory en `DatabaseModule`);
  `check()` (liveness) no toca dependencias; `ready()` agrega con `probeSafely` (nunca lanza,
  `down` con solo la clase del error — las DSN de `pg`/ioredis pueden llevar contraseñas).
- **Config:** `REDIS_URL` ahora **obligatoria**; `META_DRIVER` (`mock|real`, bloqueado en prod),
  `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET`.

## 3. Endpoints entregados (contrato `docs/api/webhooks.md`)

| Endpoint | Auth | Comportamiento clave |
|---|---|---|
| `GET /api/webhooks/whatsapp` | pública | challenge text/plain si verify_token OK; 403 `webhook_verification_failed` |
| `POST /api/webhooks/whatsapp` | pública, 600/60s | firma HMAC (401 si inválida); ingest → 200 `{received, ignored, duplicated}`; enqueue falla → 502 `external_provider_error` |
| `POST /api/v1/whatsapp/accounts` | OWNER | crea (waba/phone UNIQUE por tenant → 409); `accessToken` solo en entrada |
| `GET /api/v1/whatsapp/accounts` | OWNER | lista del tenant sin `accessToken` |

## 4. Inventario de archivos

### Config (`packages/config`)
| Archivo | Cambio |
|---|---|
| `src/api-environment.ts` | `REDIS_URL` obligatoria; `META_DRIVER/WebhookVerifyToken/WebhookAppSecret` + guard prod+mock; `REDIS_URL` en `ApiEnv` |
| `src/api-environment.spec.ts` | casos nuevos (driver, obligatoriedad, bloqueo prod) |

### Contracts (`packages/contracts`)
| Archivo | Cambio |
|---|---|
| `src/errors.ts` | `webhook_verification_failed` en catálogo canónico y vocabulario (paridad); rebuild |

### Base de datos (`packages/database`)
| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `WhatsappAccount` (2 UNIQUE por tenant), `WhatsappEvent` (UNIQUE global `provider_event_id`, FKs SET NULL), relaciones |
| `prisma/migrations/20261003192535_whatsapp_webhook_channel/migration.sql` | CREATE TABLEs + CHECKs + índices `(status, created_at)` |

### Canal WhatsApp (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/domain/ports/whatsapp-event-repository.ts` | `create → WhatsappEventRecord \| null`, `findByProviderEventId`, marks idempotentes |
| `src/domain/ports/whatsapp-account-repository.ts` | create, `findByPhoneNumberId`, `listByTenant` |
| `src/domain/ports/whatsapp-event-queuer.ts` | `enqueueEvent(providerEventId, tenantId, accountId, eventType)` |
| `src/domain/whatsapp/entities.ts` + `common/di-tokens.ts` | records + drafts; `WHATSAPP_*` y `DEPENDENCY_PROBES` |
| `src/infrastructure/database/repositories/prisma-whatsapp-event.repository.ts` | impl Prisma (P2002 → null; marks con `updateMany`) |
| `src/infrastructure/database/repositories/prisma-whatsapp-account.repository.ts` | impl Prisma (P2002 → `ConflictError`) |
| `src/infrastructure/whatsapp/meta-webhook-signature.ts` (+spec 10 tests) | HMAC timing-safe, hub subscribe, challenge |
| `src/infrastructure/queues/whatsapp-event-queue.ts` | `BullWhatsappEventQueue` |
| `src/infrastructure/workers/whatsapp-events.worker.ts` + `worker.module.ts` + `worker/main.ts` | probe worker (concurrency 5) |
| `src/infrastructure/redis/redis-dependency-probe.ts` | probe Redis (`ping`, clase del error) |
| `src/infrastructure/database/database.module.ts` | registrar `RedisDependencyProbe` + factory `DEPENDENCY_PROBES` |
| `src/modules/health/health.service.ts` (+spec) | `@Inject(DEPENDENCY_PROBES)` + `probeSafely` |
| `src/modules/whatsapp/application/whatsapp-webhook.service.ts` (+spec 11 tests) | ingest/dedup/retry/race/enqueue-fail |
| `src/modules/whatsapp/presentation/whatsapp-webhook.controller.ts` | GET + POST (firma → 401; `@HttpCode(200)`) |
| `src/modules/whatsapp/presentation/whatsapp-accounts.controller.ts` + `whatsapp-account.mapper.ts` + `dto/whatsapp-account-input.dto.ts` | OWNER; excluye token |
| `src/modules/whatsapp/whatsapp.module.ts` + `app.module.ts` + `main.ts` | wiring; `rawBody: true` + CORS `X-Hub-Signature-256` |
| `package.json` | script `start:worker` (`node dist/worker/main.js`) |
| `test/helpers/app.ts` (rawBody) · `test/helpers/database.ts` (TABLES + reset) | helpers de test |

### Docs
ADR-010; `docs/architecture/whatsapp.md`; `docs/api/webhooks.md`; `docs/database/schema.md` §10
(+renumeración); `dependency-rules.md` §5/§6; `pendiente-fase-2.md`; `PROJECT_CONTEXT.md`
(§3/§5/§13/§15/§16/§19–21/§24/§28–31); `fases/README.md`; `.env.example`; `capacidades-actuales.md`.

## 5. Verificación (evidencia, 03/10/2026)

| Etapa | Resultado |
|---|---|
| `pnpm --filter @negocia/config run lint` / `typecheck` / `test` | OK: 1 file / **34** tests |
| `pnpm --filter @negocia/{config,database,contracts} run build` | OK (rebuilds necesarios) |
| `pnpm --filter @negocia/api run lint` | OK |
| `pnpm --filter @negocia/api run typecheck` | OK (tras rebuilds de config/database/contracts) |
| `pnpm --filter @negocia/api run test` | 20 files / **208** tests |
| `pnpm --filter @negocia/api run test:integration` | 5 files / **45** tests (9 nuevos repos WhatsApp) |
| `pnpm --filter @negocia/api run test:e2e` | 5 files / **98** tests (14 nuevos: webhook + accounts + health con 2 deps) |
| `pnpm --filter @negocia/database run db:check` | OK (migración aplicada el 03/10) |
| `pnpm verify` (root, 03/10 17:30) | **exit 0**: lint + typecheck + build (incl. `next build` web) + tests + `db:check` en verde |

## 6. Incidencias y resoluciones

1. **BullMQ rechaza `connection: string`** (typecheck): BullMQ tipa `ConnectionOptions` y el
   worker usa comandos bloqueantes → conectar por instancia ioredis con `maxRetriesPerRequest: null`.
2. **POST webhook respondía 201** (default de Nest) en vez de 200 → `@HttpCode(HttpStatus.OK)`
   explícito; test e2e lo exigía (200 con reporte).
3. **`REDIS_URL` faltaba en `ApiEnv`** (typecheck de config) → añadida como obligatoria y
   reconstruido `@negocia/config`; `webhook_verification_failed` no estaba en el dist de
   `contracts` → rebuild.
4. **E2E del 403 de cuentas**: un usuario recién registrado es OWNER de su propio tenant, así que
   el 403 solo sale con un miembro ADMIN entrado por flujo de invitación → test reescrito con
   `addMemberAs` (invitation flow).
5. **Spec integración WhatsApp**: `beforeEach` sin importar (vitest) y UUIDs inventados
   (`invalid input syntax for type uuid`) → `tenantId: null` en eventos y tenants reales
   (`prisma.tenant.create`) en cuentas.
6. **Lint**: `vi` importado y sin usar en `whatsapp-webhook.service.spec.ts` → import corregido.
7. **`phone_number_id` sin estrechar** (`unknown` vs `string`) en el tipo del payload → `typeof`
   check; **`prisma-whatsapp-event.repository.ts` sin importar su puerto** → import añadido.
8. **Puerta final de `pnpm verify` (17:30)**: dos specs quedaban por detrás de los cambios de M7,
   y las atrapó el verify:
   - `packages/contracts/src/identity-vocabulary.spec.ts` — la trascripción manual de
     `DOMAIN_ERROR_CODES` (fijada a propósito, sin importar el dominio) no incluía
     `webhook_verification_failed` → `orphans ≠ []`; se añadió el código al array transcrito.
   - `packages/config/src/api-environment.spec.ts` — `validEnv()` y el test de defaults no
     traían `REDIS_URL` (ahora obligatoria) → 7 tests fallaban al arrancar; se añadió al fixture,
     al test de defaults y un test nuevo "exige REDIS_URL" (33 → **34** tests).
9. **EPERM en `next build` bajo OneDrive (entorno, no código)**: un `next dev` en ejecución
   mantenía bloqueado un archivo de `apps/web/.next`, y `next build` (etapa build de `verify`)
   reventaba con `EPERM: unlink`. Resuelto deteniendo el dev server y borrando `.next`; con los
   dev servers parados, `verify` completo termina en verde (exit 0).

## 7. Lecciones aprendidas

- La UNIQUE + `updateMany(where status anterior)` convierte redeliveries de Meta en no-ops sin
  locks: la idempotencia se paga en el esquema, no en código de cola.
- El 200 explícito y el `rawBody` son parte del **contrato con el socio externo**, no un detalle:
  olvidarlos convierte reintentos en pérdida de eventos.
- "Infra levantada sin consumidor" (Redis) se vuelve deuda de readiness: con la primera cola llega
  el probe y el consumo real; `REDIS_URL` clave obligatoria en el mismo hito.
- Los tests de integración son los que atrapan la semántica de BD (UUIDs, UNIQUEs, SET NULL):
  los fakes en memoria no pueden falsar una carrera P2002.

## 8. Próximo paso

F2-3 continúa con **Embedded Signup (M9)** + envío real de mensajes; **F2-4**
(conversaciones/mensajes, máquina de estados) consumirá la cola con el primer procesamiento de
negocio. El dashboard web (F3-1) ya puede exponer el alta de cuentas y el estado de la cola.

> **Nota (03/10, tras M8):** F2-4 se cerró en el hito `M8-fase-2-conversaciones-mensajes.md`; el
> hito diferido nombrado aquí "M8" se renumeró a **M9** (`PROJECT_CONTEXT.md` §33 D9).