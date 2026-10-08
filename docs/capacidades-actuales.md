# Capacidades actuales — negocIA (Fase 1 + F2-1/F2-2 + F2-3 + F2-4 + F3-3a + M9/M10/M11/M12)

> Estado: **Fase 1 (identidad multi-tenant) cerrada** + F2-1/F2-2 (email real + recuperación de contraseña) + **F2-3 (canal WhatsApp, ADR-010)** + **F2-4 (conversaciones y mensajes)** + **M9 (Embedded Signup + envío real + cifrado, ADR-012)** + **F3-3a (proveedor de IA, ADR-011)** + **M11 (web consumiendo la API, F3-1)** + **M12 (tiempo real SSE, live updates)** + **F3-3b parcial (motor mínimo solo worker, sin tests)** en código; tests/CI verdes.
> Verificación (08/10/2026): `pnpm verify` exit 0 — 282 unit API + 48 config + 11 contracts + 12 database / 58 integración / 109 e2e / `db:check` OK (fuentes `fases/M12-realtime-sse.md` y `fases/M11-panel-web.md`).

## Resumen

El backend es un SaaS multi-tenant funcional en su capa de **identidad y gestión de tenant**, con
el **canal de WhatsApp** operativo (webhook firmado + persistencia idempotente + colas
BullMQ `whatsapp-events`/`llm-jobs` + workers que **persisten inbound y responden vía LLM**),
**conversaciones y mensajes** (inbox de lectura + envío manual y automático OUTBOUND), **Embedded Signup
+ cifrado `access_token`** (M9/ADR-012) y el **proveedor de IA + motor mínimo** (puerto `LlmProvider`
OpenRouter + `ConversationEngineService` solo worker, `ToolCatalog` vacío, sin tests engine). La
web es un **panel completo que consume la API**: auth, conexión de WhatsApp, inbox, detalle con
respuesta manual y runs del LLM, con **live updates por SSE** (Redis pub/sub worker↔API) y polling
de 60s como red de seguridad. Pendiente de negocio: handoff a humano (F6-3), tools/gasto/tests del
motor, rotación del access_token de WhatsApp, catálogos y facturación.

## Autenticación (`/api/v1/auth`)

- `POST /register` — crea cuenta + tenant + membresía OWNER; email normalizado y contraseña con política segura.
- `POST /login` — no enumera cuentas (mismo error para email inexistente o contraseña inválida).
- `POST /refresh` — rotación de refresh token opaco (hash SHA-256); detecta y revoca reuso.
- `POST /logout` — revoca la sesión.
- `POST /revoke-all` — revoca todas las sesiones del usuario.
- `POST /switch-tenant` — cambia entre tenants del usuario.
- `GET /me` — perfil + membresías del usuario autenticado.
- `POST /forgot-password` — emite un token de reset 1-uso (15 min) por email; 204 uniforme (no filtra cuentas).
- `POST /reset-password` — consume el token, cambia la contraseña y revoca todas las sesiones.

Seguridad: JWT HS256 con claims mínimos, refresh con rotación y detección de reuso, Argon2id (OWASP), rate limiting global + por ruta.

## Email (`EMAIL_DRIVER`)

- `EMAIL_DRIVER=mock` (dev/test): `MockEmailAdapter` en memoria; los tests leen los correos con `app.get(MockEmailAdapter)`.
- `EMAIL_DRIVER=resend` (producción): `ResendEmailAdapter` (SDK `resend`), plantillas text/HTML en español con enlaces de acción sobre `APP_BASE_URL`. **`mock` con `NODE_ENV=production` es error de arranque.**

## Onboarding (`/api/v1/invitations`, `/api/v1/email-verification`)

- `POST /invitations` — invitar por email con rol (OWNER/ADMIN/AGENT), OWNER/ADMIN como autor. Matriz: un OWNER invita a OWNER/ADMIN/AGENT; un ADMIN solo a ADMIN/AGENT (403 si pide OWNER). Expira en 48 h; respeta el límite de usuarios del plan. El token va solo por email y se guarda hasheado.
- `POST /invitations/accept` — consume el token, crea la membresía y devuelve una sesión activa en ese tenant.
- `DELETE /invitations/:id` — revoca (404 si no existe o es de otro tenant, sin revelar).
- `POST /email-verification/verify` — confirma el email con token de un solo uso.
- `POST /email-verification/resend` — invalida pendientes y emite uno nuevo (rate limited).

## Tenants y usuarios (`/api/v1/tenants`)

- `GET /tenants/current` — metadatos del tenant activo (cualquier miembro activo).
- `PATCH /tenants/current` — edita `name`/`slug` (solo OWNER); `plan`/`status` no son editables por el inquilino.
- `GET /tenants/:tenantId/users` — lista plana de miembros (agenda del equipo).
- `PATCH /tenants/:tenantId/users/:userId` — cambia rol/estado (OWNER/ADMIN jerárquico; ADMIN no toca a OWNER).

## Reglas de negocio e invariantes

- Roles jerárquicos: `OWNER > ADMIN > AGENT`; el estado de membresía se relee de la base en cada request.
- Nada puede dejar al tenant **sin el último OWNER activo** (lock `SELECT … FOR UPDATE` + reconteo; 409 en carrera).
- Planes: `BASIC` (2 usuarios), `PRO` (10), `PREMIUM`; el límite se valida al invitar y se revalida al aceptar.
- Errores con catálogo canónico (`ApiError` / `API_ERROR_CODES`): `requestId` de correlación, mensajes seguros, sin stack traces.
- Aislamiento por tenant: el `:tenantId` de la URL debe coincidir con el del token (si no → 404, no 403).

## WhatsApp — canal entrante (`/api/webhooks`, F2-3, ADR-010)

- `GET /api/webhooks/whatsapp` — handshake: verifica `hub.verify_token` (timing-safe) y responde
  el `hub.challenge` **text/plain**; fallo → 403 `webhook_verification_failed`.
- `POST /api/webhooks/whatsapp` — ingestión con firma **HMAC-SHA256** del body crudo
  (`X-Hub-Signature-256`, 401 si inválida) y `@HttpCode(200)` explícito (el 201 de Nest haría
  reintentos de Meta). Dedup por UNIQUE `provider_event_id` + `jobId` de cola; JSON malformado →
  200 con reporte vacío; enqueue falla → 502 `external_provider_error` (el evento queda `FAILED`
  y se re-encola con el redelivery de Meta).
- `POST /v1/whatsapp/accounts` (OWNER) / `GET /v1/whatsapp/accounts` — alta manual de cuentas
  (`waba_id` + `phone_number_id` con UNIQUE por tenant → 409); el token se almacena **cifrado**
  (`access_token_encrypted`, AES-256-GCM) y **nunca** se devuelve.
- Embedded Signup: `GET /v1/whatsapp/accounts/embedded-signup/url` (OWNER/ADMIN/AGENT) y callback público
  `GET /v1/whatsapp/accounts/embedded-signup/callback` (intercambio code→token + persistencia cifrada). Ver ADR-012.
- Procesamiento: `whatsapp-events` en **BullMQ/Redis** consumida por un worker **separado**
  (`pnpm start:worker`) que persiste los mensajes entrantes en la conversación del cliente y
  aplica sus `statuses[]`; `META_DRIVER=mock` bloqueado en `NODE_ENV=production`.
- Health/Q4: `/api/health/ready` sondea **PostgreSQL + Redis** (`DEPENDENCY_PROBES`); solo expone
  la clase del error (nunca DSN/contraseñas). `REDIS_URL` es obligatoria.

## Conversaciones y mensajes (`/api/v1/conversations`, F2-4)

- `GET /conversations` (AGENT/ADMIN/OWNER) — bandeja paginada del tenant (`limit`/`offset`,
  filtro `status`), ordenada por `last_message_at` desc. Id ajeno fuera de tenant → lista vacía.
- `GET /conversations/:id/messages` — historial cronológico; 404 si la conversación no existe en
  el tenant (indistinguible de "no existe", nunca 403).
- Escritura: el **worker** crea la conversación (`BOT_ACTIVE`, una por `tenant+cuenta+cliente`)
  e inserta el mensaje `INBOUND` **atómicamente**; idempotencia por UNIQUE `provider_message_id`
  (un job reintentado no duplica mensajes). `statuses[]` de Meta → `delivery_status`.
- Envío OUTBOUND: `POST /v1/conversations/:id/messages` (AGENT/ADMIN/OWNER) envía texto a Meta Cloud API
  usando `access_token` descifrado (AES-256-GCM); persiste `OUTBOUND/SENT` con `provider_message_id`.
- Máquina de estados (`domain/conversations/state-machine.ts`): reglas **puras** + unit tests;
  sin endpoints de transición hasta el traspaso a humano (F6-3).

## Proveedor de IA (F3-3a, ADR-011) + motor mínimo (F3-3b parcial)

- `domain/ports/llm-provider.ts`: puerto `LlmProvider.complete()` con `messages`, `tools`,
  `toolChoice`, `temperature`, `maxTokens`; devuelve `text`, `toolCalls`, `finishReason`, `model`
  (el que **realmente** respondió) y `usage`. El puerto **no conoce el tenant** y la IA nunca
  escribe en la BD.
- `MockLlmAdapter` (`LLM_DRIVER=mock`): texto fijo + buffer de peticiones en memoria para los
  tests. **Bloqueado con `NODE_ENV=production`.**
- `OpenRouterLlmAdapter` (`LLM_DRIVER=openrouter`): `POST {LLM_BASE_URL}/chat/completions` con
  `fetch` nativo (sin SDK), `stream: false`, `AbortSignal.timeout(LLM_TIMEOUT_MS)`. Traduce los
  fallos a `LlmError` (401 key, 402 sin créditos, 429 rate limit, 5xx, cuerpo no-JSON, timeout) y
  **nunca** incluye la API key. **No reintenta**: los reintentos son de la cola.
- Configuración: `LLM_MODEL` (default `openai/gpt-4o-mini`), `LLM_BASE_URL`
  (`https://openrouter.ai/api/v1`), `LLM_APP_URL`/`LLM_APP_TITLE` (atribución opcional).
  Cambiar de modelo es **configuración, no código**.
- **Motor mínimo F3-3b (parcial, solo worker, sin tests):** `WhatsappEventsWorker` persiste el
  inbound y encola `llm-jobs` (`requestId=wa:<messageId>`); `LlmJobsWorker` → `ConversationEngineService.respond()`
  (historial 50, hasta 5 iteraciones, `ToolCatalog` hoy vacío, `llm_runs` con dedup por `requestId`,
  skip si `status!=BOT_ACTIVE`, envío OUTBOUND vía proveedor). Falta: tools de negocio, handoff a
  humano (F6-3), gasto por tenant y tests (engine/prompt/executor/workers).

## Panel web (M11, F3-1) y live updates (M12)

- **App Next.js (App Router)**: `/login`, `/register`, `/` (dashboard), `/conversations` (inbox),
  `/conversations/:id` (detalle + responder + runs del LLM), `/whatsapp` (cuentas + embedded
  signup). Guard de rutas privadas (`require-auth.tsx`) + `AuthProvider` que hidrata la sesión.
- **Cliente API (`lib/api.ts`)**: login/register, refresh con rotación **single-flight**, me,
  cuentas, embedded-signup, conversaciones, mensajes (enviar texto con Enter), runs.
- **Autorización**: el rol se relee del `membership` y la cuenta de WhatsApp se muestra solo a
  `OWNER`; la web es UX, la seguridad real vive en los `@Roles` del backend.
- **Endpoint nuevo**: `GET /v1/conversations/:id/runs` (paginado, AGENT/ADMIN/OWNER) para el
  panel de actividad del LLM.
- **Tiempo real (SSE + Redis pub/sub, M12)**: eventos `conversation.changed` publicados por API y
  worker en el canal `negocia:realtime` y re-emitidos por `GET /api/v1/events/stream` (guards
  globales + filtrado por tenant + heartbeat 25s). Cliente con fetch + ReadableStream (el
  `EventSource` nativo no manda el Bearer) y reconexión con backoff 1s→30s; una sola conexión por
  pestaña, atada a la sesión.
- **Polling de respaldo**: 60s en inbox/detalle/dashboard (el push cubre mensajes nuevos y cambios
  de run); WhatsApp mantiene 15s. Sin Redis, el panel degrada a polling.

## Consumirla

```bash
pnpm run dev        # API :4000 + web :3000 (watch)
pnpm --filter @negocia/api start:worker   # consume whatsapp-events (requiere build previo)
```

- API: `http://localhost:4000/api`
- Swagger UI: `http://localhost:4000/api/docs`
- Web: `http://localhost:3000` (panel: requieres registrarte/loguearte)
- SSE: `GET http://localhost:4000/api/v1/events/stream` (header `Authorization: Bearer`)
- Cambios: `pnpm verify` (lint, typecheck, build, unit, integración, e2e, `db:check`).

## Fuera de alcance de esta fase

**Handoff a humano (F6-3)** (endpoints de transición de la máquina de estados), **cierre del
motor F3-3b** (tools de negocio + gasto por tenant + tests del engine), **rotación del
`access_token` de WhatsApp (F7-D3)**, catálogos, clientes, pedidos, facturación y RLS. Ver
`docs/pendiente-fase-2.md`.