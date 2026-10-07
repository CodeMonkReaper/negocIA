# ADR-010 — Canal de entrada WhatsApp Cloud API (webhook + cola + worker)

- **Estado:** Aceptado
- **Fecha:** 2026-10-03
- **Ámbito:** Fase 2 — canal de mensajería entrante (`F2-3`)

> **Nota de trazabilidad (03/10, tras el hito M8):** este ADR difirió Embedded Signup y el envío
> real a un hito que entonces se llamaba "M8". El número `M8` se usó después para el hito de
> conversaciones/mensajes (`fases/M8-fase-2-conversaciones-mensajes.md`), así que el hito diferido
> queda renumerado como **M9** y las referencias de este documento se actualizaron en consecuencia.
> El contenido normativo del ADR no cambia. Ver `PROJECT_CONTEXT.md` §33 D9.

## Contexto

El producto recibe las interacciones de los clientes por **WhatsApp Cloud API de Meta**. El
webhook de Meta es un endpoint HTTP público que entrega eventos de mensajes; sin embargo,
cuando un webhook se recibe **dentro** del request HTTP, con el ciclo de petición de NestJS
ocupado, hay tres problemas que este ADR resuelve con una sola arquitectura:

1. **Idempotencia:** Meta reintenta cualquier respuesta distinta de 200 y puede entregar el
   mismo evento más de una vez (flaky networks, retries). Persistir y deduplicar por el id del
   proveedor es la única forma segura de recibir dos veces y procesar una.
2. **Bloqueo del request:** procesar un mensaje (LLM, tools, respuestas) dentro del handler del
   webhook mantendría el socket ocupado, haría que Meta remarquara el evento y acoplaría la
   entrega a la salud de features no relacionadas (cola de entrada).
3. **Libertad de escala:** el procesamiento de mensajes es un workload de cola (BullMQ), no un
   workload HTTP; debe vivir en **procesos worker separados del mismo monorepo** (modular
   monolith, ADR-001), no en el web server.

Además, Fase 1 dejó dos precondiciones a cubrir en este hito: la infraestructura **Redis está
levantada pero ningún consumidor la usa** (Q4, `PROJECT_CONTEXT.md` §19), y el **healthcheck de
readiness** solo sondea PostgreSQL (`health/ready`). Este hito introduce el primer consumidor
real de Redis (la cola) y amplía la sonda de readiness de 1 a N dependencias.

### Restricciones adoptadas en sesión (aprobadas)

- **Sin credenciales reales de Meta** en desarrollo/test: el driver es `mock` por defecto,
  y **se bloquea `NODE_ENV=production`** (mismo patron que `EMAIL_DRIVER`). El driver real
  (`META_DRIVER=real`) queda disponible y activable por config.
- **Embedded Signup se difiere a M9**: en M7 el alta de cuentas es **manual** (el OWNER del
  tenant registra `waba_id` + `phone_number_id` + `access_token`). Meta Signup añade el flujo
  OAuth del síndrome de "client-side token" y no bloquea el canal entrante.

## Decisión

### 1. El webhook es un endpoint de ingestión, no de procesamiento

`POST /api/webhooks/whatsapp` (nombre de cola `whatsapp-events`):

1. **Validación de firma** `X-Hub-Signature-256` (HMAC-SHA256 del body crudo, comparación
   timing-safe). El body se lee **crudo** (`rawBody: true`, `main.ts` y `test/helpers/app.ts`):
   sin el raw body no hay firma que verificar y Meta permite que el valor venga sin el prefijo
   `sha256=`.
2. **Handshake** `GET /api/webhooks/whatsapp` público: verifica el `hub.verify_token` por
   comparación timing-safe y responde el `hub.challenge` como **text/plain** (Meta solo acepta
   el string); ante fallo → 403 `webhook_verification_failed`.
3. **Normalización e ingestión** (`WhatsAppWebhookService.ingest`): toma `unknown` del body,
   descarta el envoltorio de Meta (`entry[].changes[]`), valida el payload con guards estructurales
   (`isRecord`, `Array.isArray`), deduce evento/tenant/cuenta y **persiste
   `whatsapp_events`** con `provider_event_id` único. Si el tenant/cuenta no está registrado, el
   evento se ignora (200, sin fila): no sirve de oráculo de cuentas.
4. **Dedup en dos capas:** la UNIQUE `provider_event_id` hace que el segundo `create` devuelva
   `null` (carrera segura) y `markEnqueued` se acota por status anterior (`where status =
   RECEIVED|FAILED`), así que re-encolar un evento ya `ENQUEUED|PROCESSED|DEDUPLICATED` es un
   no-op.
5. **Después del 200:** se encola el id del evento en BullMQ (`jobId = providerEventId`, así la
   cola tampoco acepta duplicados). Si encolar falla el evento queda `FAILED` y se responde
   `external_provider_error` (502): Meta reintentará y el estado `FAILED` se re-intenta.

El request responde **`200` con `@HttpCode(HttpStatus.OK)`** explícito porque el default 201 de
Nest haría que Meta reintentara. Un JSON malformado responde igualmente 200 con el reporte vacío
(evitar el bucle de reintentos por un problema no resuelto en nuestro lado). El endpoint es
`@Public()` (Meta no envía bearer), con `@Throttle` propio de 600/60s.

### 2. El procesamiento vive en un worker BullMQ separado

- `BullWhatsappEventQueue` (ports `WhatsappEventQueuer`) usa **una instancia de ioredis** (no un
  string): BullMQ tipa `ConnectionOptions` y el worker usa comandos bloqueantes, luego
  `maxRetriesPerRequest: null` es obligatorio. `jobId = providerEventId`, `attempts = 3`,
  backoff exponencial 2s, `removeOnComplete: 1000`, `removeOnFail: 5000`.
- `WhatsappEventsWorker` (proceso `pnpm start:worker` = `node dist/worker/main.js`): consume con
  concurrency 5, re-lee el evento por `providerEventId` y llama `markProcessed` (idempotente).
  Worker = proceso aparte del mismo `apps/api`, como manda ADR-001. La cola `whatsapp-events`
  **no** se procesa dentro del web server en M7 (procesamiento "probe" que solo marca
  `PROCESSED`); el LLM y la resolución de negocios quedan para F2-4/F3-x.

### 3. Alta manual de cuentas (Embedded Signup → M9)

`POST /api/v1/whatsapp/accounts` (only OWNER): crea el número con `waba_id` + `phone_number_id`
(dos UNIQUE por tenant → 409 `conflict` en solapamiento) y persiste `access_token`. El token
**nunca** se devuelve en respuestas (el mapper de salida lo excluye) y su gestión de secretos es
deuda registrada (`F7-D3`). El webhook resuelve la cuenta entrante por `phone_number_id`.

### 4. Readiness con N dependencias (Q4)

`HealthService` deja de instanciar la sonda de PostgreSQL y recibe `DEPENDENCY_PROBES` como
array (postgres + redis) mediante factory en `DatabaseModule`. `check()` (liveness) sigue sin
tocar dependencias; `ready()` agrega cada probe con `probeSafely` (nunca lanza; expone solo la
**clase** del error, nunca el mensaje — las DSN de `pg`/ioredis pueden incluir contraseñas).
`REDIS_URL` pasa a ser **obligatoria** en `validateEnv` (antes opcional), igual que
`DATABASE_URL`.

### 5. Configuración y datos

- Nuevas vars (todas con `validateEnv`): `REDIS_URL` (obligatoria), `META_DRIVER` (`mock|real`,
  default `mock`, bloqueado en producción), `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET`.
- Migración `20261003192535_whatsapp_webhook_channel`: tablas `whatsapp_accounts` (tenants con
  FK RESTRICT) y `whatsapp_events` (account/tenant con FK `SET NULL`; UNIQUE global
  `provider_event_id`; índice `(status, created_at)` para barridos de reintentos).
- El `access_token` **no** se loguea; el endpoint de health nunca expone mensajes internos.

## Consecuencias

- **Positivas:** el webhook es ingestión pura; idempotencia garantizada por PK/DN en dos capas
  (BD + cola); cero procesamiento dentro del request; Redis deja de ser infra "muerta" (Q4) y la
  cola es el primer consumidor real; readiness refleja PG+Redis; el canal se puede conectar a
  Meta solo con config (mismo patrón de driver que email).
- **Negativas / deuda:** el worker de M7 es un *probe* (marca PROCESSED, no procesa negocio);
  la gestión segura de `access_token` (cifrado/rotation) queda para F7-D3; no hay `dev:worker`
  (solo `start:worker` tras build); la limpieza de cola/eventos viejos no tiene job de
  mantenimiento.

## Alternativas consideradas

- **Persistir el payload crudo del webhook y reprocesarlo luego** — se descarta: duplicaría el
  esquema sin aportar nada sobre persistir el evento ya normalizado.
- **Webhook → cola directa sin BD** — descarta: la BD es la fuente de idempotencia y el
  estado visible para reencolar fallos; sin ella el retry de Meta es la única garantía.
- **Embedded Signup en M7** — difiere a M9: el flujo OAuth de Meta no era bloqueante para el
  canal entrante y añade superficie de seguridad sin valor para el hito.