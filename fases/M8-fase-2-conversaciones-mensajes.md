# M8 — Fase 2: conversaciones y mensajes (persistencia + inbox de lectura)

| Campo | Valor |
|---|---|
| Fase | 2 (conversaciones/mensajes / F2-4) |
| Fecha | 03/10/2026 |
| Estado | **Completo** en código y verificación de suites |
| Referencias normativas | `docs/database/schema.md` §11, `docs/api/conversations.md`, `docs/architecture/whatsapp.md`, legacy §11/#12/#20, `PROJECT_CONTEXT.md` §24 (F2-4) |

## 1. Contexto y objetivo

El canal entrante (M7) encola eventos en `whatsapp_events` pero su worker no hace negocio ("probe").
F2-4 convierte ese worker en el **primer procesador real**: persiste el mensaje del cliente en una
conversación y expone el inbox del agente (`GET /conversations`, `GET /conversations/:id/messages`).
El LLM (F3-3) ya tiene el dato que responderá: el historial.

Decisiones de alcance aprobadas en sesión:

1. **Solo mensajes entrantes y estados de entrega:** el worker consume `messages[]` (→ conversación
   + mensaje `INBOUND`) y `statuses[]` (→ `delivery_status`). El envío real (`OUTBOUND`) es M9.
2. **Idempotencia en escritura:** UNIQUE global `messages.provider_message_id` (los `wamid` de Meta
   son únicos entre tenants) + transacción atómica: un job reintentado (BullMQ at-least-once) no
   duplica mensajes.
3. **Máquina de estados pura:** `domain/conversations/state-machine.ts` fija las reglas
   `BOT_ACTIVE→HUMAN_REQUESTED→HUMAN_ACTIVE→CLOSED` (legacy §11/#20) con unit tests, pero **sin**
   endpoints de transición: el traspaso a humano es F6-3. F2-4 solo produce `BOT_ACTIVE`.

### Criterios de done

1. Migración `conversations` + `messages` (CHECKs de status/dirección/delivery_status, UNIQUE de
   conversación por `tenant+cuenta+cliente`, UNIQUE global de `wamid`).
2. Worker procesa `messages[]`/`statuses[]` con transacción idempotente y `markProcessed` solo al final.
3. `GET /api/v1/conversations` (paginado + filtro `status`) y `GET /api/v1/conversations/:id/messages`
   (cronológico); roles AGENT/ADMIN/OWNER; id ajeno → 404 indistinguible, nunca 403.
4. Máquina de estados pura + mapper de Meta totales (payloads malformados → listas vacías).
5. Suites unit / integración / e2e en verde + lint + typecheck + `db:check` OK.

Fuera de alcance: traspaso a humano (F6-3), envío real de mensajes (M9), motor de conversación
LLM (F3-3), modelo de contactos/`customer_id` (F6), `assigned_user_id`/`mode`.

## 2. Decisión de diseño

- **Dominio** (`src/domain/conversations/`): `entities.ts` (records + drafts), `state-machine.ts`
  (mapa de transiciones + `assertValidTransition` → `InvalidTransitionError`, 409 `conflict`),
  `meta-message.mapper.ts` (parser **total** de `change.value`: funciones puras, nunca lanzan).
- **Persistencia** (`prisma-conversation.repository.ts`): `recordInboundMessage` corre dentro de
  `$transaction`. `upsert` de la conversación por `(tenant_id, account_id, customer_wa_id)` →
  insert del mensaje (`createdAt` explícito) → `last_message_at = receivedAt`. Si el `wamid` ya
  existe, el P2002 deshace la transacción entera (incluida una conversación recién creada) y
  devuelve `"duplicated"`. `recordDeliveryStatus` solo toca filas del tenant (no-op si el mensaje
  aún no existe: los ACKs pueden adelantar a la pieza).
- **Servicio** (`ConversationsService`): `ingestInbound` orquesta drafts + statuses del mismo
  `value` y devuelve `{messagesInserted, statusesApplied}`; `listMessages` hace `getConversation`
  previamente (404 si no existe en el tenant).
- **Worker** (`whatsapp-events.worker.ts`): deja de ser probe; inyecta `ConversationsService` y
  procesa antes de `markProcessed`. Si el ingest lanza, el job falla y BullMQ reintenta (los writes
  son idempotentes).
- **API** (`conversations.controller.ts`): `@Roles("OWNER","ADMIN","AGENT")` (jerárquico → mínimo
  AGENT); paginación `limit` (1–100) / `offset`; `status` con `@IsEnum` → 400 si invalido; `:id`
  con `@IsUUID` → 400. Mapper explícito (no viaja la fila).

## 3. Endpoints entregados (contrato `docs/api/conversations.md`)

| Endpoint | Auth | Comportamiento clave |
|---|---|---|
| `GET /api/v1/conversations` | AGENT+ | página `{items,total}`, orden `last_message_at` desc; `?limit=&offset=&status=` |
| `GET /api/v1/conversations/:id/messages` | AGENT+ | historial ascendente; 404 si id ajeno o inexistente; 400 si `:id` no es uuid |

## 4. Inventario de archivos

### Base de datos (`packages/database`)
| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `Conversation` (UNIQUE 3-tupla) + `Message` (UNIQUE global `provider_message_id`) + relaciones en `Tenant`/`WhatsappAccount` |
| `prisma/migrations/20261004120000_conversations_messages/migration.sql` | CREATE TABLEs + índices + CHECKs (status/dirección/delivery_status) + COMMENTS |

### API (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/domain/conversations/entities.ts` | records + drafts + constantes de estado/dirección/delivery |
| `src/domain/conversations/state-machine.ts` (+spec 9 tests) | transiciones puras; `InvalidTransitionError` (`domain/errors` 409) |
| `src/domain/conversations/meta-message.mapper.ts` (+spec 9 tests) | parser total de `change.value` |
| `src/domain/ports/conversation-repository.ts` | findById/listByTenant/recordInboundMessage/recordDeliveryStatus/listMessages |
| `src/infrastructure/database/repositories/prisma-conversation.repository.ts` | impl Prisma ($transaction + P2002 → duplicated) |
| `src/infrastructure/database/database.module.ts` + `common/di-tokens.ts` | `PrismaConversationRepository` + token `CONVERSATION_REPOSITORY` |
| `src/infrastructure/workers/whatsapp-events.worker.ts` | worker real: `ConversationsService.ingestInbound` → `markProcessed` |
| `src/worker.module.ts` | proveer `ConversationsService` + nueva factory del worker |
| `src/modules/conversations/application/conversations.service.ts` (+spec 4 tests con fake) | ingest + lecturas (404) |
| `src/modules/conversations/presentation/conversations.controller.ts` + `conversation.mapper.ts` + `dto/*` | GETs + DTOs Swagger/class-validator |
| `src/modules/conversations/conversations.module.ts` + `app.module.ts` | wiring HTTP |
| `test/conversations.integration.spec.ts` (7 tests) | repo contra PG real |
| `test/conversations.e2e-spec.ts` (8 tests) | HTTP: roles, aislamiento, paginación, 404 |
| `test/helpers/database.ts` | TABLES += `conversations`, `messages` |

### Docs
`docs/database/schema.md` §11 (renumeración §11–14→§12–14); `docs/api/conversations.md`;
`docs/architecture/whatsapp.md` (pipeline con ingest); `docs/capacidades-actuales.md`;
`docs/pendiente-fase-2.md` (F2-4 ✅, sin `META_API_TOKEN`); `docs/README.md`; `PROJECT_CONTEXT.md` §24.

## 5. Verificación (evidencia, 03/10/2026)

| Etapa | Resultado |
|---|---|
| `pnpm --filter @negocia/database run validate` | OK |
| `pnpm --filter @negocia/database run migrate:deploy` | aplica `20261004120000_conversations_messages` (5 migraciones) |
| `pnpm --filter @negocia/database run build` | OK (client regenerado) |
| `pnpm --filter @negocia/api run typecheck` | OK |
| `pnpm --filter @negocia/api run test` | 23 files / **230** tests (+22: state-machine, mapper, service) |
| `pnpm --filter @negocia/api run test:integration` | 6 files / **52** tests (+7: repos conversaciones) |
| `pnpm --filter @negocia/api run test:e2e` | 6 files / **106** tests (+8: GET conversaciones) |
| `pnpm verify` (root, 03/10 17:54) | **exit 0**: lint + typecheck + build + tests (230+34+11+7) + integración + e2e + `db:check` |

## 6. Incidencias y resoluciones

1. **`Object.freeze` ensanchaba los arrays de transiciones a `readonly string[]`** (typecheck de
   `state-machine.ts`) → objeto tipado con `as const` en lugar de `Object.freeze`.
2. **Test de la máquina asumía `CLOSED → CLOSED`** válido (`canTransition(from,"CLOSED")` sobre
   todos los estados) → el bucle se restringe a los estados activos; los no-op se rechazan.
3. **Integración con ids no-UUID** (`invalid input syntax for type uuid`): el repo pasaba bien; el
   test usaba falsos ids de string para "el otro tenant". Al ser columnas `@db.Uuid`, hay que usar
   `randomUUID()` para lo ajeno (mismo gotcha documentado en M7 §6.5).
4. **E2E: `provider_message_id` es UNIQUE global** — seed compartía `wamid.e2e-1` entre tenants →
   segunda siembra violaba la UNIQUE; el prefijo se hace único por tenant (`randomUUID`).
5. **E2E AGENT leía con el token pre-invitación**: `accept` devuelve una sesión nueva reencuadrada
   en el tenant del owner (patrón de `whatsapp.e2e-spec` `addMemberAs`); usar `accept.body`.
6. **`lastMessageAt` null en el seed manual** (el repo lo escribe, la siembra directa no) → el
   seed lo fija explícitamente para ejercitar el DTO.
7. **Puerta final `pnpm verify`**: la etapa lint atrapó una variable `repo` desestructurada y sin
   usar en `conversations.service.spec.ts` (un test no la consumía) → destructuring limpio y lint
   en verde; el verify de cierre (03/10 17:54) termina con exit 0.

## 7. Lecciones aprendidas

- La idempotencia de escritura se paga **en el esquema** (UNIQUE global del `wamid`) y se cierra
  con **transacción**: el reintento no puede dejar una conversación nueva sin su mensaje.
- Un parser de webhook **total** (nunca lanza) deja el "malformed → no-op" en el mismo lugar para
  webhook (M7) y worker: la frontera de confianza es el tipo Meta, no el código de cada extremo.
- La máquina de estados como **reglas puras + unit tests** avanza el dominio sin exponer endpoints
  prematuras; el 409 con `{from,to}` en detalles se traduce solo en el filtro de errores existente.
- Los tests e2e expusieron dos supuestos de integración (UNIQUE global, sesión tras `accept`) que
  los unit tests con fakes no pueden ver: siguen siendo la red de seguridad de los contratos de BD.

## 8. Próximo paso

El LLM (F3-3) encuentra el historial persistido listo para leer. Siguiente hito técnico
disponible: **F3-3 — `LLMProvider` (abstracción + driver; el proveedor se decide después) y motor
de conversación** que responde tras persistir el inbound. El **dashboard web (F3-1)** ya puede
consumir `GET /conversations` como primer endpoint de negocio.

Además queda diferido **M9 — Embedded Signup + envío real de mensajes** (añadirá `OUTBOUND` y el
uso real de `whatsapp_accounts.access_token`), bloqueado por dependencias de negocio
(verificación de la app en Meta y credenciales reales). Este hito se llamaba antes "M8" y se
renumeró a **M9** porque el número ya identificaba este documento (`PROJECT_CONTEXT.md` §33 D9).