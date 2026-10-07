# Pendiente — lo que falta en negocIA

> Complemento de `docs/capacidades-actuales.md`.

## Fase 2 — funcionalidad central de negocio

- **Integración con WhatsApp en F2-3** → **hecho (03/10):** canal **entrante** completo
  (webhook verificado por firma + idempotencia `provider_event_id` + enqueue BullMQ +
  worker separado). **Embedded Signup + envío real** completados en **M9** (ADR-012); queda SDK de Meta.
- **Conversaciones y mensajes (F2-4)** → **hecho (03/10):** el worker persiste los mensajes
  entrantes en la conversación del cliente (idempotencia por `provider_message_id`) y la API
  expone `GET /v1/conversations`, `GET /v1/conversations/:id/messages` y
  `POST /v1/conversations/:id/messages` (OUTBOUND). Pendiente: **traspaso a humano**
  (transiciones de la máquina de estados en la API, F6-3).
- ~~**Proveedor de LLM / IA**~~ → **hecho el proveedor (03/10, F3-3a):** puerto `LlmProvider` en el
  dominio + `MockLlmAdapter` y `OpenRouterLlmAdapter` (OpenRouter vía `fetch` nativo), selección por
  `LLM_DRIVER` con `mock` bloqueado en producción y errores traducidos a `LlmError` (ADR-011). El
  modelo es configuración (`LLM_MODEL`), no código.
- Flujo de conversación end-to-end entre WhatsApp → worker → LLM: **motor mínimo F3-3b parcial ya
  operativo** (`WhatsappEventsWorker` → cola `llm-jobs` → `LlmJobsWorker` → `ConversationEngineService.respond()`,
  tabla `llm_runs` con dedup `requestId=wa:<messageId>`). Falta para cerrarlo: tools de negocio
  (`ToolCatalog` hoy vacío), handoff a humano (F6-3), gasto por tenant y tests (engine/prompt/executor/workers).
- Modelos de negocio asociados: catálogos, productos/servicios, clientes, pedidos, reservas, agenda.

## Pendientes de cierre de Fase 1

- ~~**Proveedor real de email**~~ → **hecho (03/10):** `ResendEmailAdapter` (SDK `resend`) detrás de `EMAIL_DRIVER`, ghost `mock` bloqueado en producción (ADR-009). Antes se usaba `MockEmailAdapter`.
- ~~**Recuperación de contraseña**~~ → **hecho (03/10):** `POST /v1/auth/forgot-password` y `POST /v1/auth/reset-password` (token 1-uso de 15 min, `invalid_token` unificado, revocación de sesiones; ADR-009).
- **Web**: la app Next.js es solo un panel de estado; falta consumir la API y construir el onboarding/dashboard de gestión del tenant.

## Deudas técnicas menores

- ~~Health check extendido con dependencias (PostgreSQL, Redis).~~ → **hecho (03/10, Q4):**
  `HealthService` agrega `DEPENDENCY_PROBES` (postgres + redis); `REDIS_URL` obligatoria.
- ~~Primeros specs de `@negocia/config` y `@negocia/database`.~~ → **hecho (03/10):** `config/api-environment.spec.ts` (validateEnv/resolveEnvPath), `database/index.spec.ts` + `database/check-connection.spec.ts`; `checkConnection` extraído de `scripts/check.ts`.
- ~~`API_PORT=0` distinguir "puerto efímero" de "malformado".~~ → **hecho (03/10)** en `validateEnv`.
- Reconciliar `dependency-rules.md:34` ("el env usa Zod") con `validateEnv` (desviación registrada en §13.5 del informe).
- Rotación del `access_token` de WhatsApp (F7-D3, cifrado at-rest ya completado en M9);
  limpieza de `whatsapp_events` viejos y de jobs de cola (pendiente de job de mantenimiento).

## Infraestructura y despliegue

- Colas asíncronas (BullMQ/Redis) **en uso**: `whatsapp-events` (canal entrante) + `llm-jobs`
  (motor mínimo F3-3b). Pendiente: jobs de mantenimiento/limpieza y `dev:worker` (solo existe `start:worker`).
- Despliegue (CI ya existe en GitHub Actions; falta entorno de producción, migraciones en CD, secrets).
- Alojamiento web/app y DNS de la API.

## Notas de gobernanza

- Todo pendiente de producto/negocio debe validarse contra `PROJECT_CONTEXT.md` y registrarse en `fases/README.md` (bitácora) al completarse.