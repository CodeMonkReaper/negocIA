# ADR-011 — Proveedor de IA: puerto `LlmProvider` con driver OpenRouter

- **Estado:** Aceptado
- **Fecha:** 2026-10-03
- **Ámbito:** Fase 3 — asistente conversacional (`F3-3`, hito **M10**)

## Contexto

F2-4 (M8) dejó las conversaciones y el historial persistidos, pero **nadie responde todavía**:
el worker marca `PROCESSED` y nada más. El primer consumidor real del historial es el modelo de
lenguaje.

Al diseñar el proveedor hay tres decisiones que se cierran aquí y que condicionan todo lo que
venga (el motor, las tools, el gasto):

1. **Qué API se habla.** El asistente se dirige a clientes de PyMEs por WhatsApp: mensajes
   cortos, frecuentes y con tolerancia baja a la latencia, pero el flujo de caja exige que el
   costo por conversación sea predecible y que los límites de uso sean los de una suscripción
   SaaS, no los de una tarjeta que se puede agotar. Necesitamos **cambiar de modelo sin tocar
   código y sin redesplegar**, y poder pasar de un modelo barato a uno mejor con solo configuración.
2. **Dónde entra el multitenant.** El motor vive dentro de un monolith modular (ADR-001) y ya hay
   `TenantContext`, RLS y cuentas de WhatsApp por tenant. El proveedor de IA no debe saber nada de
   tenants: si el puerto llevara `tenantId`, cada fake y cada test del motor arrastraría el
   multitenant, y el gasto por tenant quedaría enterrado en un `if` de un `fetch`.
3. **Cuánto abstraer.** Un motor de conversación necesitará tools, reintentos, handoff a humano y
   registro de cada ejecución. Si el puerto solo expone `prompt → texto`, todo eso se implementa
   después **rompiendo el puerto y sus fakes**.

## Decisión

### 1. Un puerto en el dominio, un adaptador por proveedor

`apps/api/src/domain/ports/llm-provider.ts` define `LlmProvider.complete(request) →
LlmCompletion` más los tipos `LlmMessage`, `LlmToolDefinition`, `LlmToolCall`, `LlmUsage`.
Tres propiedades son normativas:

- **El puerto no conoce el tenant.** No hay `tenantId` en ninguna firma. El aislamiento es
  responsabilidad de quien llama (el application service del motor), y el registro de gasto por
  tenant vivirá en `llm_runs` (hito del motor), no en el puerto.
- **La IA nunca es la fuente de verdad.** El puerto devuelve texto *propuesto*; escribir en la BD
  es de los application services y sus puertos.
- **Los tools se declaran ahora aunque este hito no los use.** El catálogo pertenece al motor
  (F3-3b); declarar la forma ahora evita romper el puerto y sus fakes cuando lleguen.

`finishReason` es una unión cerrada (`stop | length | tool_calls | content_filter | error`) y el
adaptador **degrada cualquier valor desconocido a `"error"`** en vez de inventar estados: quien
llama puede fiarse de que la unión de fin es la de ese archivo.

### 2. OpenRouter como driver real, con `fetch` nativo

OpenRouter es un agregador: una sola API y una sola clave dan acceso a los modelos de varios
proveedores y el slug del modelo es **configuración**. Es la respuesta directa al punto 1 del
contexto y la razón por la que cambiar de modelo no es un ticket de código.

`apps/api/src/infrastructure/llm.openrouter.ts`:

- `POST ${LLM_BASE_URL}/chat/completions` con `Authorization: Bearer`, cuerpo compatible con la
  API de chat de OpenAI (`messages`, `tools`, `tool_choice`, `temperature`, `max_tokens`) y
  **`stream: false`**. El consumidor es un worker de cola que persiste la respuesta completa: el
  streaming no aporta ahí y sí complica el manejo de errores, porque un fallo a mitad de stream
  llega como evento SSE con HTTP 200.
- **`fetch` nativo, sin SDK y sin dependencias nuevas**, con `baseUrl` y `fetchImpl` inyectados
  para poder probar el payload exacto sin red. Mismo criterio que `MetaCloudProvider`.
- `AbortSignal.timeout(LLM_TIMEOUT_MS)`.
- Traduce el error a `LlmError` con un mensaje propio por causa —401 key, 402 sin créditos, 429
  rate limit, resto 4xx/5xx, cuerpo no-JSON, 200 sin `choices`, timeout, fallo de red— y
  **nunca incluye la API key** en el mensaje ni en los detalles. El 402 tiene mensaje propio a
  propósito: OpenRouter prepaga, así que "se quedó sin créditos" es la causa más probable de un
  fallo total en producción y no debe aparecer como "rechazó la petición".
- Registra en `LlmCompletion.model` el modelo que **realmente** respondió, no el pedido: con alias
  y routing son distintos, y es lo que permite atribuir el gasto.
- **No reintenta.** Los reintentos son de la cola (BullMQ), no de la capa HTTP: reintentar aquí
  multiplicaría los cobros sin saber si la petición anterior llegó a consumirse.

`apps/api/src/infrastructure/llm.mock.ts` (`MockLlmAdapter`) devuelve un texto fijo y **guarda
las peticiones en un buffer en memoria** en vez de imprimirlas: un prompt en la salida de un test
es historial de un cliente en los logs de CI, y los logs de CI se archivan. Los e2e lo/leen con
`app.get(MockLlmAdapter)`. El texto es fijo **y sin relación con la petición** a propósito: cuando
llegue el motor, ningún test debe pasar por accidente porque el mock "sabía" la respuesta.

### 3. Selección por driver en configuración, con guard de producción

Mismo patrón que `EMAIL_DRIVER` y `META_DRIVER` (ADR-009, ADR-010), aplicado en `LlmModule`:

| Var | Default | Regla |
|---|---|---|
| `LLM_DRIVER` | `mock` | `mock \| openrouter`; **bloqueado en producción** |
| `OPENROUTER_API_KEY` | `""` | obligatoria solo con `openrouter` |
| `LLM_MODEL` | `openai/gpt-4o-mini` | slug de https://openrouter.ai/models |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | http(s) **con path** (proxy propio) |
| `LLM_TIMEOUT_MS` | `20000` | entero positivo |
| `LLM_APP_URL` / `LLM_APP_TITLE` | `""` | opcionales; headers `HTTP-Referer` / `X-OpenRouter-Title` |

El guard de producción es el mismo de los otros canales: el mock devolvería un texto fijo a
clientes reales, así que se prefiere fallar en el arranque y descubrirlo en una conversación en
vivo. Los headers de atribución solo se envían si hay valor: son cosméticos (ranking público de
openrouter.ai) y no se manda `HTTP-Referer: undefined`.

### 4. Este hito no consume el proveedor

`LlmModule` se importa en `app.module.ts` y exporta `LLM_PROVIDER` (y `MockLlmAdapter` para los
tests), pero **ningún caso de uso lo inyecta todavía**. Deliberado: el motor (F3-3b) correrá como
proceso del worker y se cableará en `worker.module.ts` con la cola `llm-jobs`. Dejar el proveedor
disponible y probado por separado permite que el motor llegue sin mezclar dos metabolismos.

## Consecuencias

- **Positivas:** el motor (F3-3b) se escribe contra un puerto de 6 tipos y se testea sin red ni
  tokens; cambiar de modelo o de proveedor es configuración; el gasto por tokens ya está
  disponible en cada respuesta (`usage`) para atribuirlo; `mock` mantiene la suite determinista y
  sin costo.
- **Negativas / deuda:** el agregador es un punto de dependencia y añade un salto de latencia; no
  hay streaming (correcto para cola, insuficiente si algún día el dashboard quiere tokens en vivo
  → requeriría SSE); `llm_runs`, idempotencia por request y cola `llm-jobs` **no** existen
  todavía; no hay reintentos en la capa HTTP (los aporta la cola en F3-3b); no hay caché de
  completions, así que dos mensajes idénticos cuestan dos llamadas; la observabilidad de gasto solo
  existirá cuando exista `llm_runs`.

## Alternativas consideradas

- **SDK oficial de OpenRouter** — se descarta: es un cliente generado sobre el mismo endpoint que
  ya se habla con `fetch`, y añade dependencia, versión y superficie de tipos a un único POST. El
  contrato estable es HTTP.
- **Llamar directamente a OpenAI/Anthropic** — se descarta para esta etapa: fija el proveedor en
  código y con la clave, y perder el cambio de modelo por configuración. El puerto deja la puerta
  abierta a un driver por proveedor si algún cliente exige un SLA o un modelo que OpenRouter no
  enrute.
- **Exponer el modelo/prompts como DTO de API o usar un orquestador externo (n8n, Flowise)** —
  se descarta: pone el cerebro del producto fuera del repositorio, fuera de los tests y fuera del
  control de acceso por tenant.
- **Meter `tenantId` en `LlmCompletionRequest`** para atribuir gasto en el mismo puerto — se
  descarta: mezcla el aislamiento (responsabilidad del caller) con la métrica del proveedor, y
  hace que el puerto dependa del multitenant.
- **Streaming desde el inicio** — se descarta para este consumidor: el worker necesita la respuesta
  completa para persistirla, y un error a mitad de stream llega como HTTP 200.
