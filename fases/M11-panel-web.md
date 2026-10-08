# M11 — Fase 3/F3-1: panel web consumiendo la API (auth, inbox, runs)

| Campo | Valor |
|---|---|
| Fase | 3 — F3-1 (web consumiendo la API) |
| Fecha | 07/10/2026 |
| Estado | **Completo** en código y verificado (`pnpm verify` verde) |
| Referencias normativas | `docs/capacidades-actuales.md`, `docs/pendiente-fase-2.md`, `fases/M10-llm-provider-openrouter.md` §8 (próximo a F3-1) |
| Commit | `eae8896` `feat(panel): panel web (auth, embedded signup, inbox) y endpoint de runs de LLM` |

## 1. Contexto y objetivo

M8/M9/M10 dejaron el backend funcional (auth multi-tenant, canal WhatsApp entrante,
conversaciones/mensajes, Embedded Signup + envío real, proveedor de IA) pero la app Next.js
solo era un panel de estado que **no consumía la API**. Este hito convierte la web en el panel de
gestión del tenant y consume el backend completo.

Alcance aprobado en sesión: flujo completo de autenticación, conexión de WhatsApp por embedded
signup, inbox de conversaciones, detalle de conversación con mensajes + respuesta manual y la
lista de runs del motor de IA. Para exponer los runs al panel se añade el endpoint
`GET /v1/conversations/:id/runs`.

### Criterios de done

1. Cliente de API en el web (`lib/api.ts`) con login/register, refresh rotatorio single-flight,
   y métodos para me, cuentas, embedded-signup, conversaciones, mensajes y runs.
2. `AuthProvider` (React context) que hidrata la sesión al abrir el tab, y guards de ruta
   (`require-auth.tsx`) para las secciones privadas.
3. Páginas: `/login`, `/register`, `/` (dashboard), `/conversations` (inbox), `/conversations/[id]`
   (detalle + responder + runs), `/whatsapp` (cuentas + embedded signup).
4. Endpoint API `GET /conversations/:id/runs` (paginado) + DTOs en `@negocia/contracts`.
5. Lint/typecheck/build verdes + tests de API e2e/integration del endpoint de runs.

### Fuera de alcance (decisión explícita)

Live updates (se entrega en **M12**), traspaso a humano (F6-3), catálogo de tools y gasto por
tenant (F3-3b completo).

## 2. Decisiones de diseño

- **Client components con App Router** (`"use client"`): todo el panel corre en el cliente y cada
  página hace SSR de shell + hidratación; el `AuthProvider` se monta en `app/layout.tsx`.
- **Rotación single-flight del refresh** en `lib/api.ts`: si N peticiones chocan con 401, todas
  comparten una única promesa de refresh (`refreshPromise`) para no rotar la familia varias veces
  y quemarla por "reuso" detectado en el server.
- **Guard por rol en la web** solo visual: detrás está el `@Roles` del backend. `/whatsapp`
  muestra el controlador de cuentas solo a `OWNER` (decisión del usuario vía pregunta) con
  `membership?.role === "OWNER"`.
- **Embedded Signup** embebido en el panel (`connect-whatsapp.tsx`): si la cuenta ya tiene
  `accessTokenEncrypted`, no se muestra el botón de "solo lectura" que oculta el flujo; el estado
  se relee tras el callback de la ventana popup.
- **Endpoint de runs**: `ConversationsService.listRunsForConversation` delega en
  `LlmRunRepository.listByConversation` (tenant + conversación); el repositorio Prisma ya filtra
  por tenant con RLS-equivalente (tenant context).

## 3. Inventario de archivos

### Web (`apps/web`)
| Archivo | Contenido |
|---|---|
| `app/layout.tsx` | providers globales (`AuthProvider` envuelto en `app/(app)/layout.tsx`) |
| `components/providers.tsx` / `components/require-auth.tsx` | montaje del provider + guard de rutas privadas |
| `components/app-shell.tsx` | shell del panel (navegación, logout) |
| `components/ui.tsx` | kit base (Button, Card, Badge, Spinner, TextArea, input) |
| `components/connect-whatsapp.tsx` | flujo Embedded Signup (popup + callback) |
| `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx` | login y registro |
| `app/(app)/page.tsx` | dashboard (cuentas + conversaciones recientes) |
| `app/(app)/conversations/page.tsx` | inbox paginado (20/página, "cargar más") |
| `app/(app)/conversations/[id]/page.tsx` | detalle: mensajes, responder (Enter), runs de LLM |
| `app/(app)/whatsapp/page.tsx` | cuentas de WhatsApp + embedded signup (solo OWNER) |
| `components/api-status.tsx` (eliminado) | el panel de estado viejo se retira |
| `lib/api.ts`, `lib/auth.tsx`, `lib/format.ts`, `lib/status.ts` | cliente API, contexto de auth, formato, helpers de estado |

### API (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/modules/conversations/presentation/conversations.controller.ts` | `GET /conversations/:id/runs` (paginado, `@Roles("OWNER","ADMIN","AGENT")`) |
| `src/modules/conversations/application/conversations.service.ts` | `listRunsForConversation` |
| `src/modules/conversations/presentation/conversation.mapper.ts` | `toLlmRunResponse` (DTO de contratos) |
| `src/domain/ports/llm-run-repository.ts` | `listByConversation` con paginación |
| `src/infrastructure/repositories/prisma-llm-run.repository.ts` | query por tenant + conversación |
| `test/conversations.e2e-spec.ts` / `test/conversations.integration.spec.ts` | tests del endpoint de runs |

### Contratos (`packages/contracts`)
`src/llm.ts` (DTO de run) + export en `src/index.ts`.

## 4. Variables de entorno

| Var | Uso |
|---|---|
| `NEXT_PUBLIC_API_URL` | base de la API para el cliente (`http://localhost:4000/api` por defecto) |

**Sin migración de base de datos.**

## 5. Verificación (evidencia, 07/10/2026)

El commit `eae8896` pasó lint + typecheck + build del web y la suite completa del API (el estado
final se re-verificó íntegro en M12). Números del verify completo en `fases/M12-realtime-sse.md`
§5.

## 6. Incidencias y resoluciones

1. **Linter web estricto (`react-hooks/set-state-in-effect`)** bloqueó los `useEffect` con
   `setState` sincrónico (p.ej. `setMessages(...)` fuera de un `await`). Resolución: el patrón
   permitido es `async IIFE` local con `await load()`/fetches dentro y `setState` post-`await`, o
   `setInterval`/suscripciones (callbacks no son `setState` sincrónico en el effect).
2. **`.next` con tipos stale** rompió un `next build`: al añadir/renombrar DTOs de contratos, la
   caché de Turbopack no refrescó los tipos → limpiar `.next` y reconstruir (lección anotada en M12 §7).

## 7. Lecciones aprendidas

- El `refreshPromise` single-flight es necesario **desde el primer día** de un SPA multi-tab con
  rotación de refresh; sin él, dos pestañas rotan y la segunda revoca la familia.
- El backend es la única fuente de autorización: los guards de la web son UX, no seguridad.
- El límite de 20/página con "cargar más" y el refresco del inbox conviven pero deben respetar el
  mismo orden (`last_message_at desc`) para no duplicar filas al anexar.

## 8. Próximo paso

**M12 — live updates** (polling fallback + tiempo real SSE/Redis): se entrega en el hito siguiente
y reemplaza el polling de 15s/10s por push en inbox/detalle/dashboard manteniendo el polling de
60s como red de seguridad.