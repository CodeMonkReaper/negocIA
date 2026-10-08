# M12 — Live updates: polling de respaldo + tiempo real por SSE (Redis pub/sub)

| Campo | Valor |
|---|---|
| Fase | 3 — web (mejora de UX del panel, M11) |
| Fecha | 07/10/2026 |
| Estado | **Completo** en código y verificado (`pnpm verify` verde) |
| Referencias normativas | `docs/capacidades-actuales.md`, `docs/pendiente-fase-2.md`, `fases/M11-panel-web.md` §8 |
| Commits | `ea7111b` `feat(web): live updates por polling en inbox, detalle, dashboard y WhatsApp` y `b063446` `feat: tiempo real por SSE (Redis pub/sub) para inbox, detalle de conversacion y runs` |

## 1. Contexto y objetivo

M11 dejó el panel en lectura con refresco manual. El usuario pidió "live updates" y, al probar el
pollling, preguntó **"no puede ser en tiempo real?"**. Este hito entrega el panel en **tiempo real
real**: eventos `conversation.changed` publicados por API y worker (vía **Redis pub/sub**, porque
el worker es un proceso separado) y re-emitidos al navegador por un endpoint **Server-Sent Events**
(SSE). El polling se conserva como red de seguridad a 60s.

### Criterios de done

1. Publicador de eventos (`EventPublisher`) usable desde **API y worker** sin acoplarlos: puente
   Redis `negocia:realtime`.
2. Canal SSE en el API, autenticado por los guards globales y filtrado **por tenant** (un evento
   de otro tenant nunca llega).
3. La web abre una única conexión SSE (fetch + ReadableStream, porque `EventSource` no manda
   headers con el Bearer), con reconexión/backoff, y para/arranca con la sesión (`AuthProvider`).
4. Emisiones de `conversation.changed` en los puntos donde cambia el estado visible del panel:
   ingestión de inbound, envío OUTBOUND, y arranque/terminación de runs del motor de IA.
5. Polling de respaldo degradado de 15s/10s → 60s en inbox, detalle y dashboard. **WhatsApp queda
   con polling** (15s) por decisión explícita.
6. Lint/typecheck/build + unit/integration/e2e verdes.

### Fuera de alcance

`account.changed` **no** se emite en este hito (redundante con `postMessage` + polling), aunque el
contrato lo declara para el futuro. Streaming de completions del LLM tampoco (el consumidor es un
worker).

## 2. Decisiones de diseño

- **SSE sobre WebSocket.** Unidireccional (API→navegador), reconexión trivial con backoff,
  funciona tras proxies sin handshake de upgrade; el panel no necesita mandar nada al stream.
- **Redis pub/sub como puente worker↔API.** El webhook persiste el inbound en el proceso worker
  (BullMQ) y el motor de IA responde también en el worker; el SSE vive en el API. Sin el puente,
  el worker no podría notificar al API. Un único canal `negocia:realtime` con el `tenantId` dentro
  del payload.
- **Un solo suscriptor por API, fan-out en proceso** (`node:events` + rxjs `Observable`):
  `RealtimeServer` cierra una conexión Redis y re-emite por tenant a cada `@Sse` suscrito. La
  suscripción es **perezosa** (primera conexión SSE) para que los tests sin Redis arranquen igual.
- **Publisher best-effort**: fallos de Redis no rompen el flujo de negocio (el polling cubre el
  hueco). El `at` lo pone el publicador al emitir.
- **Una conexión SSE por pestaña** (`lib/realtime.ts` singleton): `AuthProvider` la arranca con la
  sesión y la aborta al cerrarla; las páginas se suscriben con el hook `useRealtime`. Penalización
  por tráfico: heartbeat `: keep-alive` cada 25s.
- **SSE filtrado por tenant en el server**: el `Principal.tenantId` del request corta cualquier
  evento ajeno. Los roles `@Roles("OWNER","ADMIN","AGENT")` sobre el controller protegen la ruta.
- **`GG` de seguridad**: el payload conserva `event`, `tenantId`, `at` y `conversationId`; el
  cliente ignora líneas `:` (comentarios/heartbeat) y reintenta con backoff exponencial 1s→30s.
- **El contrato incluye `account.changed`** para evitar un breaking change de contratos cuando se
  active, pero hoy solo se publica `conversation.changed`.

## 3. Inventario de archivos

### Contratos (`packages/contracts`)
`src/realtime.ts` (`RealtimeEventType` = `"conversation.changed" | "account.changed"`,
`RealtimeEventDto` con `event`, `tenantId`, `at`, `conversationId?`, `accountId?`) + export en
`src/index.ts`. **Requiere rebuild (`tsc`) del paquete** porque se consume desde `dist`.

### API (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/domain/ports/event-publisher.ts` | puerto `EventPublisher.publish({ event, tenantId, conversationId? })` |
| `src/common/di-tokens.ts` | token `EVENT_PUBLISHER` + `PORT_TOKENS.eventPublisher` |
| `src/infrastructure/realtime/redis-client.ts` | `RealtimeRedis` (duck-type para tests), `REALTIME_CHANNEL`, `createRealtimeRedis` (ioredis, `maxRetriesPerRequest: null`) |
| `src/infrastructure/realtime/realtime-publisher.ts` | implementación best-effort (no-throwing) |
| `src/infrastructure/realtime/realtime-server.ts` | suscriptor Redis lazy + fan-out por tenant + heartbeat 25s |
| `src/infrastructure/realtime/realtime-events.controller.ts` | `@Controller("events")`, `@Sse("stream")` → `GET /api/v1/events/stream` |
| `src/infrastructure/realtime/realtime.module.ts` | `@Global`, factory de `EVENT_PUBLISHER` (se importa en **API y worker**) |
| `src/infrastructure/realtime/realtime-sse.module.ts` | provee `RealtimeServer` + controller (solo API) |
| `src/modules/conversations/application/conversations.service.ts` | publica `conversation.changed` al insertar inbound (por conversación) y por cada `statuses[]` aplicado (sin conversationId); y tras `recordOutboundMessage` en `sendMessage` |
| `src/modules/conversation-engine/application/conversation-engine.service.ts` | publica al arrancar el run y en `finally` (estado terminal), con guard de `started` |
| Specs actualizados | `conversation-engine.service.spec.ts` (stub `EventsStub` + 2 tests nuevos), `conversations.service.spec.ts`, `conversations-whatsapp-expiry.spec.ts` |
| Specs nuevos | `realtime-publisher.spec.ts` (JSON del payload + best-effort), `realtime-server.spec.ts` (filtro por tenant, malformados, subscribe idempotente) |
| `src/app.module.ts` | importa `RealtimeModule` + `RealtimeSseModule` |
| `src/worker.module.ts` | importa `RealtimeModule` (publicador en el worker) |

Detalle de las emisiones:
- `ingestInbound`: un publish por cada mensaje insertado (`conversationId`), y **un único** publish
  (sin `conversationId`) si algún `statuses[]` se aplicó.
- `sendMessage`: publish tras persistir el OUTBOUND (el panel del agente y el del cliente ven el
  mensaje al instante).
- `ConversationEngineService.respond`: publish en `started=true` (el run aparece como RUNNING) y en
  `finally` con `started` (estado terminal o mensaje saliente). El caso `duplicated` no publica
  nada.

### Web (`apps/web`)
| Archivo | Contenido |
|---|---|
| `lib/use-poll.ts` | hook de polling (pausa con `document.visibilityState`, callback en ref) |
| `lib/realtime.ts` | singleton de conexión SSE (fetch + reader + parser SSE + backoff 1s→30s), `startRealtime`/`stopRealtime`/`subscribeRealtime` |
| `lib/use-realtime.ts` | hook `useRealtime(handler)` que suscribe/desuscribe |
| `lib/api.ts` | `API_BASE` ahora exportado (lo usa el cliente SSE) |
| `lib/auth.tsx` | effect que arranca/para el stream según `status` de sesión |
| `app/(app)/conversations/[id]/page.tsx` | suscripción filtrada por `conversationId` (o sin conversación) → `refreshAll`; polling 60s |
| `app/(app)/conversations/page.tsx` | `reloadFirstPage` (guarda si ya cargó más de 20) disparado por cualquier `conversation.changed`; polling 60s |
| `app/(app)/page.tsx` | dashboard: cualquier `conversation.changed` → `load()`; polling 60s |
| `app/(app)/whatsapp/page.tsx` | **sin cambios**: sigue con polling de 15s (decisión explícita) |

## 4. Variables de entorno

| Var | Uso |
|---|---|
| `REDIS_URL` | ya obligatoria (health/colsas); el publisher y el suscriptor SSE la usan |

**Sin migración de base de datos.**

## 5. Verificación (evidencia, 08/10/2026 — `pnpm verify` exit 0)

| Etapa | Resultado |
|---|---|
| `pnpm run lint` (turbo, 6 paquetes) | 9 tasks OK |
| `pnpm run typecheck` (turbo, 6 paquetes) | 9 tasks OK |
| `pnpm run build` | contracts/config/database/api (`nest build`) + web (`next build`, 7 rutas) OK |
| `pnpm run test` | api 32 files / **282 tests** (4 skipped) · config 48 · contracts 11 · database 12 |
| `test:integration` | 6 files / **58 tests** |
| `test:e2e` | 6 files / **109 tests** |
| `db:check` | PostgreSQL connection OK |

M11 + M12 en verde de forma conjunta; el endpoint SSE no tiene test e2e de cliente porque requiere
Redis + conexión persistente — la lógica de filtrado y formato cubierta por `realtime-server.spec.ts`
y el cliente por construcción (parser trivial + reconexión testeada manualmente en dev).

## 6. Incidencias y resoluciones

1. **`@nestjs/common` no exporta `Observable`** → import de `rxjs` en el controller (`type Observable`).
2. **Paths relativos del controller**: vivía en `infrastructure/realtime/` (un nivel más profundo
   que los `presentation/`), por lo que `../../../` apuntaba fuera de `src/` → `../../` para
   `common/` y `domain/`, y `./realtime-server` para el vecino.
3. **Duck-typing de ioredis**: `subscribe(channel: string): Promise<string[]>` no era asignable a la
   firma real (params con Buffer/callback y return `Promise<unknown>`) → la interfaz se aflojó a
   `subscribe(...channels: unknown[]): Promise<unknown>`. Los specs inyectan un doble sin librería.
4. **Spec del server**: `RealtimeServer` no tiene `close()`, el cierre es `onModuleDestroy()` →
   el spec lo invoca y verifica `quit()`.
5. **Orden de claves en JSON**: `parseRealtimeEvent` reconstruye el objeto en otro orden y la
   igualdad estricta del string falló en el spec → assert por `JSON.parse(payload.data)` en vez de
   comparar el serializado.
6. **Spec engine**: `const events: EventPublisher` en el setup ocultaba `published` a las
   aserciones → se tipa `const events = new EventsStub()` para que el retorno infiera la clase.
7. **Linter (`react-hooks/set-state-in-effect`)**: los páginas reutilizan el patrón de M11
   (async IIFE con `await load()`), y el stream se suscribe desde el effect vía el hook
   `useRealtime` (suscripción externa, permitida). Handlers de las páginas envueltos en
   `useCallback` para no resuscribir en cada render.

## 7. Lecciones aprendidas

- **Worker separado + evento → puente Redis obligatorio**: la arquitectura de proceso único de
  pruebas no sirve aquí; el Redis pub/sub desacopla publicación (worker y API) de consumo (API).
- **`EventSource` no manda headers**: para un stream autenticado con Bearer, `fetch` +
  `ReadableStream` es el camino, a costa de implementar reconexión/backoff a mano.
- **Suscripción lazy + best-effort**: permite que el arranque y los tests no dependan de Redis;
  el coste es que sin Redis el panel funcionará solo con polling (degradación controlada).
- Los efectos del web deben distinguir `setState` sincrónico (prohibido) de suscripciones y
  timers (permitidos): entender la regla evita pelear con el linter.
- Un contrato nuevo en `@negocia/contracts` casi nunca es "solo tipos": todo lo que lo consume
  lee `dist`, y olvidar el rebuild rompe typecheck del API en el primer `pnpm verify`.

## 8. Próximo paso

**F6-3 — traspaso a humano (handoff):** endpoints de transición de la máquina de estados de
conversación ("tomar conversación", pausa/skip del bot, devolver al bot) que ya está pura en
`domain/conversations/state-machine.ts` sin consumidores HTTP. Además en cola: cerrar **F3-3b**
(tools de negocio en `ToolCatalog`, gasto por tenant, tests del engine/prompt/executor) y la
**rotación del access_token de WhatsApp (F7-D3)**.