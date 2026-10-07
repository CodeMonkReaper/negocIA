# M10 — Fase 3: proveedor de IA `LlmProvider` + driver OpenRouter (F3-3a)

| Campo | Valor |
|---|---|
| Fase | 3 (agente / asistente conversacional — F3-3a) |
| Fecha | 03/10/2026 |
| Estado | **Completo** en código y verificación de suites |
| Referencias normativas | `docs/adr/011-llm-provider-openrouter.md`, `docs/architecture/dependency-rules.md` §5, `PROJECT_CONTEXT.md` §24 (F3-3a), `docs/capacidades-actuales.md` |

## 1. Contexto y objetivo

F2-4 (M8) dejó las conversaciones y el historial persistidos, pero **nadie responde**: el worker
marca `PROCESSED` y no hay más. El primer consumidor real del historial es el modelo de lenguaje.

El alcance aprobado en sesión fue **solo el proveedor**, no el motor de conversación. La razón es
que el motor arrastra decisiones que aún no están cerradas (cola `llm-jobs` en el worker, catálogo
de tools, handoff a humano, tabla `llm_runs`, idempotencia por request). Implementar el proveedor
primero permite que el motor llegue contra un contrato ya probado, sin mezclar dos metabolismos.

El número de hito es **M10** y no M9 porque `M9` quedó reservado para Embedded Signup + envío real
(ver `PROJECT_CONTEXT.md` §33 D9).

### Criterios de done

1. Puerto de dominio `LlmProvider` + tipos (`messages`, `tools`, `toolCalls`, `usage`,
   `finishReason`) exportados desde `domain/ports`.
2. Driver `mock` (dev/test) y driver real **OpenRouter** implementando el puerto, sin dependencias
   nuevas y con errores traducidos a `LlmError`.
3. Configuración `LLM_*` validada en `validateEnv`, con `mock` bloqueado en producción.
4. `LlmModule` cableado en `app.module.ts` y tests de env fijando `LLM_DRIVER=mock`.
5. Unit tests de ambos adaptadores + `validateEnv`; suites verdes + lint + typecheck + `db:check`.

### Fuera de alcance (decidido explícitamente)

Motor de conversación, cola `llm-jobs`, catálogo de tools, tool execution, handoff a humano,
tabla `llm_runs` / gasto por tenant, idempotencia por request, streaming/SSE, caché de
completions, y la web. Todo eso es **F3-3b**.

## 2. Decisiones de diseño

- **Puerto en el dominio, adaptador en infraestructura** (`llm-provider.ts` / `llm.openrouter.ts`),
  igual que `WhatsAppProvider`/`EmailSender`. El motor importará solo el puerto.
- **El puerto no conoce el tenant.** Sin `tenantId` en ninguna firma: el aislamiento es del
  application service que llama, y el gasto por tenant vivirá en `llm_runs` (F3-3b).
- **`fetch` nativo, sin SDK.** El contrato de OpenRouter es la API de chat de OpenAI sobre HTTPS;
  un SDK aportaría dependencia y versión para un único POST. `baseUrl` y `fetchImpl` inyectados
  permiten testear el payload exacto sin red.
- **No-streaming.** El consumidor es un worker de cola que persiste la respuesta completa; además
  un fallo a mitad de stream llega como evento SSE con HTTP 200, lo que rompe el manejo de errores.
- **No reintenta en la capa HTTP.** Los reintentos son de la cola (BullMQ); reintentar aquí
  multiplicaría cobros sin saber si la petición anterior se consumió.
- **`MockLlmAdapter` guarda las peticiones** en un buffer en memoria en vez de imprimirlas: un
  prompt en la salida de un test es historial de un cliente en los logs de CI. Los e2e lo leerán
  con `app.get(MockLlmAdapter)`.
- **Selección por `LLM_DRIVER`** con el mismo patrón de `EMAIL_DRIVER`/`META_DRIVER`, incluido el
  guard que bloquea `mock` en producción.

## 3. Inventario de archivos

### API (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/domain/ports/llm-provider.ts` | `LlmMessage`, `LlmToolDefinition`, `LlmToolCall`, `LlmUsage`, `LlmCompletionRequest`, `LlmCompletion`, `LlmProvider` |
| `src/domain/ports/index.ts` | export de los tipos LLM |
| `src/common/di-tokens.ts` | `LLM_PROVIDER` + `PORT_TOKENS.llmProvider` |
| `src/infrastructure/llm.mock.ts` | `MockLlmAdapter` (buffer `completions`, `clear()`, texto fijo) |
| `src/infrastructure/llm.openrouter.ts` | `OpenRouterLlmAdapter` (`POST /chat/completions`, `stream:false`, timeout, mapeo de errores) |
| `src/infrastructure/llm.module.ts` | `LlmModule` (factory por `LLM_DRIVER`, exporta `LLM_PROVIDER` y `MockLlmAdapter`) |
| `src/infrastructure/llm.openrouter.spec.ts` | 23 tests: payload, tool calls, errores por status, timeout, no-filtrado de la key |
| `src/infrastructure/llm.mock.spec.ts` | 4 tests: texto fijo, buffer, `clear()`, aislamiento entre instancias |
| `src/app.module.ts` | importa `LlmModule` |
| `test/helpers/app.ts` | fija `LLM_DRIVER=mock` y `LLM_MODEL` en el env de e2e |

### Configuración (`packages/config`)
| Archivo | Contenido |
|---|---|
| `src/api-environment.ts` | `LLM_DRIVERS`, `DEFAULT_LLM_DRIVER/MODEL/BASE_URL/TIMEOUT_MS`, bloque `ApiEnv`, validación, helper `isHttpEndpoint` |
| `src/api-environment.spec.ts` | 13 tests nuevos (defaults, coerción, driver inválido, key obligatoria, guard de producción, URL con path, timeout, atribución) |
| `.env.example` | sección "Proveedor de IA (F3-3)" |

### Docs
`docs/adr/011-llm-provider-openrouter.md` (nuevo); `docs/architecture/dependency-rules.md` §5
(fila `LlmProvider`); `docs/README.md`; `docs/capacidades-actuales.md`; `docs/pendiente-fase-2.md`;
`PROJECT_CONTEXT.md` (§1, §2, §13, §19, §20, §21, §24, §27, §29, §33 D8–D10); `README.md`;
`fases/README.md`.

## 4. Variables de entorno

| Var | Default | Regla |
|---|---|---|
| `LLM_DRIVER` | `mock` | `mock \| openrouter`; bloqueado con `NODE_ENV=production` |
| `OPENROUTER_API_KEY` | `""` | obligatoria solo con `LLM_DRIVER=openrouter` |
| `LLM_MODEL` | `openai/gpt-4o-mini` | slug de openrouter.ai; cambio sin redesploy |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | http(s) **con path** (permite proxy propio) |
| `LLM_TIMEOUT_MS` | `20000` | entero positivo |
| `LLM_APP_URL` / `LLM_APP_TITLE` | `""` | opcionales; headers `HTTP-Referer` / `X-OpenRouter-Title` |

**Sin migración de base de datos**: este hito no toca el esquema.

## 5. Verificación (evidencia, 03/10/2026)

| Etapa | Resultado |
|---|---|
| `pnpm --filter @negocia/config run test` | 44 tests OK (+13 LLM) |
| `pnpm --filter @negocia/api run test` | 25 files / **257** tests (+27: 23 openrouter + 4 mock) |
| `pnpm --filter @negocia/api run test:integration` | 6 files / 52 tests |
| `pnpm --filter @negocia/api run test:e2e` | 6 files / 106 tests |
| `pnpm verify` (root) | **exit 0**: lint + typecheck + build + unit (257+44+11+7) + integración + e2e + `db:check` |

## 6. Incidencias y resoluciones

1. **`typecheck` del API falló con `TS18048: 'rawBody.choices' is possibly 'undefined'`**: el type
   guard comprobaba `Array.isArray(choices)` pero `OpenRouterCompletionResponse.choices` estaba
   declarado opcional, así que TypeScript no estrechaba nada → se hizo `choices` **requerido** en la
   interfaz de la respuesta 200. El lint no lo detectó (no es su regla) pero el `verify` sí.
2. **Un edit juntó dos líneas** en `api-environment.ts` al insertar el bloque LLM →
   immediate: se verificó con `read` y se corrigió antes de seguir.

## 7. Lecciones aprendidas

- Un type guard que valida con `Array.isArray` **debe** declarar el campo como requerido, o el
  estrechamiento no ocurre y el error aparece lejos de la causa.
- `LLM_BASE_URL` **no** puede validarse con el mismo helper que `APP_BASE_URL`: aquel exige
  pathname vacío (base para componer rutas), y la de OpenRouter es un endpoint con path
  (`/api/v1`). Se añadió `isHttpEndpoint` (solo esquema http/https) en vez de relajar el otro.
- El guard de "mock bloqueado en producción" tiene coste: **rompió dos tests de producción
  preexistentes** que ahora deben declarar también un driver de LLM real. Es la misma fricción
  útil que ya payaron email y Meta.

## 8. Próximo paso

**F3-3b — motor de conversación.** Ya tiene el historial persistido (F2-4) y el proveedor cableado
(F3-3a). Le corresponde: la cola `llm-jobs` en el proceso worker, el catálogo de tools (que el
puerto ya declara), el handoff a humano, y la tabla `llm_runs` con idempotencia por request y
gasto por tenant (el `usage` del puerto ya lo entrega). También pendiente: **M9** (Embedded Signup
+ envío real) y **F3-1** (web consumiendo la API).
