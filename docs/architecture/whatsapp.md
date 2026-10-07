# Arquitectura — Canal de entrada WhatsApp (F2-3/F2-4)

> Fuente de verdad: código (`apps/api/src/infrastructure/queues`, `infrastructure/workers`,
> `infrastructure/whatsapp`, `modules/whatsapp`, `modules/conversations`). Decisión formal:
> `docs/adr/010-whatsapp-webhook-channel.md`.

## 1. Visión de canal

El canal **entrante** de WhatsApp se entrega en tres tramos: **ingestión** (HTTP) →
**persistencia + idempotencia** (PostgreSQL) → **procesamiento** (cola BullMQ / worker separado).
El web server **nunca procesa negocio de mensajes**: recibe, deduplica, encola y responde 200.

```
Meta (webhook, X-Hub-Signature-256)
   │  POST /api/webhooks/whatsapp   (body crudo)
   ▼
WhatsAppWebhookController  (GET challenge; POST → firma HMAC → ingest)
   │
   ▼
WhatsAppWebhookService.ingest      ──────────────┐
   │  normaliza entry[].changes[]                  │ ignora si tenant/cuenta
   │  PrismaWhatsappEventRepository.create         │   no registrados (200)
   │  (UNIQUE provider_event_id ⇒ null en carrera) │
   │  status = RECEIVED                            │
   ▼                                             ▼
whatsapp_events(row)  ── markEnqueued ──►  BullWhatsappEventQueue (jobId=provider_event_id)
                                                │  ioredis (maxRetriesPerRequest null)
                                                ▼
                                      WhatsappEventsWorker (proceso `start:worker`)
                                                │  concurrency 5
                                                ▼
                                      ConversationsService.ingestInbound (F2-4)
                                      messages[]  → conversations + messages (UNIQUE wamid)
                                      statuses[]  → messages.delivery_status
                                                ▼
                                      markProcessed → ACK
```

Errores de enqueue: `markFailed` (status `FAILED`, reintentable) + respuesta
`external_provider_error`. El endpoint de cola nunca devuelve el 201 default de Nest (200
explícito) para no provocar reintentos de Meta.

## 2. Contrato del webhook

| Ruta | Método | Auth | Detalle |
|---|---|---|---|
| `/api/webhooks/whatsapp` | `GET` | `@Public` | Verifica `hub.verify_token` (timing-safe) → responde `hub.challenge` **text/plain**; fallo → 403 `webhook_verification_failed` |
| `/api/webhooks/whatsapp` | `POST` | `@Public` + `@Throttle(600/60s)` | `X-Hub-Signature-256` inválida → 401; body crudo → `ingest`; 200 `{ received, ignored, duplicated }` |

- `rawBody: true` es **obligatorio** (firma HMAC-SHA256 sobre los bytes exactos): ver
  `main.ts` y `test/helpers/app.ts`. CORS incluye la cabecera `X-Hub-Signature-256`.
- Meta entrega el mismo evento más de una vez; `provider_event_id` UNIQUE + `jobId` en la cola
  protegen las dos fronteras.
- JSON malformado → 200 con reporte vacío (no entrar en bucle de reintento).

## 3. Dedup e idempotencia (semántica de estados)

`whatsapp_events.status ∈ RECEIVED | ENQUEUED | PROCESSED | FAILED | DEDUPLICATED`.

| Situación | Comportamiento |
|---|---|
| Primer evento | `create` → `RECEIVED` → enqueue OK → `ENQUEUED` |
| Redelivery de evento ya `ENQUEUED/PROCESSED/DEDUPLICATED` | `create` devuelve `null`, no-op, 200 (duplicado) |
| Enqueue falló antes | evento en `FAILED` → el redelivery sí re-encola (retryable) |
| Carrera de dos copies simultáneos | el que pierde el UNIQUE recibe `null` y trata de ganador (200) |
| `markEnqueued`/`markProcessed`/`markFailed` | `updateMany` con el status anterior en el `where`: idempotentes entre procesos |

El worker solo marca `PROCESSED` si encontró `ENQUEUED`; procesar un evento es declarativo y no
se paga por duplicado.

## 4. Puertos y adaptadores

| Puerto | Adapter |
|---|---|
| `WhatsappWebhookIngest` (application service) | usa `WhatsappEventRepository` |
| `WhatsappEventRepository` | `PrismaWhatsappEventRepository` |
| `WhatsappAccountRepository` | `PrismaWhatsappAccountRepository` |
| `WhatsappEventQueuer` | `BullWhatsappEventQueue` (BullMQ + ioredis) |
| `WhatssappEventsWorker` | proceso `worker/main.ts` (ApplicationContext Nest) |

Tokens DI en `common/di-tokens.ts`: `WHATSAPP_EVENT_REPOSITORY`, `WHATSAPP_ACCOUNT_REPOSITORY`,
`WHATSAPP_EVENT_QUEUER`, `WHATSAPP_WEBHOOK_LOGGER`, `DEPENDENCY_PROBES`.

## 5. Alta de cuentas (Embedded Signup + alta manual)

- **Embedded Signup (OAuth Meta)**: `GET /api/v1/whatsapp/accounts/embedded-signup/url` (OWNER/ADMIN/AGENT, auth) retorna `{url, state}` para iniciar OAuth. `GET /api/v1/whatsapp/accounts/embedded-signup/callback` (**público**) intercambia `code/state` por token, persiste cuenta WABA con `access_token_encrypted` (AES-256-GCM), estado `ACTIVE`, vinculado al tenant del principal que generó el `state`. Errores mapeados a `EmbeddedSignup*`. Ver ADR-012.
- **Alta manual**: `POST /api/v1/whatsapp/accounts` (rol OWNER) + `GET /api/v1/whatsapp/accounts` (listar OWNER): persisten `waba_id` / `phone_number_id` / `access_token_encrypted` con UNIQUE por tenant (409 `conflict`). El token **no** se expone en respuestas.
- El webhook resuelve la cuenta por `phone_number_id` y el `tenant_id` del evento sale del número. El `access_token` se descifra **solo** en tiempo de ejecución para envío OUTBOUND.

## 6. Firma y handshake (Meta)

`infrastructure/whatsapp/meta-webhook-signature.ts`:
- `isValidHubSignature(secret, body, header)` — HMAC-SHA256, header con o sin prefijo `sha256=`,
  compara en tiempo constante; body vacío/sin header ⇒ `false`.
- `isHubSubscribeRequest(query, expectedToken)` — `hub.mode === "subscribe"` Y `hub.verify_token`
  con comparación timing-safe; `hubChallenge` solo extrae el string.

## 7. Cola y worker

- **Cola**: `whatsapp-events`, jobs `process-event` con `jobId = providerEventId`, `attempts:
  3`, backoff exponencial 2s, `removeOnComplete: 1000`, `removeOnFail: 5000`. Conexión ioredis
  con `maxRetriesPerRequest: null` (requisito para comandos bloqueantes del worker).
- **Worker**: `pnpm start:worker` → `node dist/worker/main.js`; `WorkerModule` compone
  `ConfigModule(forRoot with validateEnv)` + `DatabaseModule` + `BullWhatsappEventQueue` (factory
  con `REDIS_URL`). Sin worker arriba, los jobs quedan en cola sin perderse (acuñados en
  Postgres por la fila `ENQUEUED`).

## 8. Health/Q4

`HealthService` inyecta `DEPENDENCY_PROBES = [PrismaDependencyProbe, RedisDependencyProbe]` y
`ready()` agrega con `probeSafely` (nunca lanza; error → `down` exponiendo solo la clase del
error, nunca el mensaje/DSN). `GET /api/health` (liveness) no toca dependencias. `REDIS_URL` es
ahora obligatoria en `validateEnv`.

## 9. Configuración nueva (validateEnv)

```dotenv
REDIS_URL=redis://localhost:6379
META_DRIVER=mock            # mock | real ; mock bloqueado en NODE_ENV=production
META_WEBHOOK_VERIFY_TOKEN=…
META_WEBHOOK_APP_SECRET=…
META_APP_ID=…
META_APP_SECRET=…
META_EMBEDDED_SIGNUP_REDIRECT_URI=…
ENCRYPTION_KEY=<32-bytes-base64-para-aes-256-gcm>
```

## 10. Fuera de alcance / deuda registrada

- Motor de conversación con LLM (F3-3b), SDK de Meta alternativo, limpieza de eventos/cola viejos, `dev:worker`
  (solo `start:worker`). (Embedded Signup + envío real + cifrado de `access_token` completados en M9).