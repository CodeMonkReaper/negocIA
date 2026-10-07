# 1. Objetivo

Definir cómo se **propaga, valida y porta** el tenant context a través de todos los puntos de entrada del sistema, incluyendo procesos asíncronos que no tienen JWT.

# 2. Concepto

`TenantContext` es un objeto inmutable con:

```ts
interface TenantContext {
  tenantId: string;          // siempre presente en operaciones tenant-scoped
  userId: string | null;     // null en webhooks/tools sin usuario resolvible
  role: Role | null;         // rol del principal en el tenant (si aplica)
  source: Source;            // cómo se obtuvo el contexto
}

type Source =
  | 'HTTP_JWT'      // request HTTP autenticado
  | 'WORKER_JOB'    // job BullMQ con tenantId explícito
  | 'WEBHOOK'       // webhook verificado de proveedor externo
  | 'TOOL'          // ejecución de una Tool del LLM
  | 'SYSTEM';       // operación interna/super-admin (sin tenant)
```

`TenantContext` **nunca** se construye a partir de datos de la request no validados (el cliente puede alterar headers, body, query).

# 3. Transporte

Se propaga mediante `AsyncLocalStorage` (`TenantContextService` en NestJS), lo que evita pasar el contexto como parámetro por cada firma y evita el scope REQUEST por request. El context se establece en la entrada (guard / middleware / worker handler) y queda disponible para toda la cadena asíncrona: servicio → repositorio → transacción Prisma → `SET LOCAL`.

# 4. Flujo 1 — HTTP → Application → DB

```text
Request HTTP
   │
   ├─ JwtAuthGuard: verifica firma/expiración del access token
   │        (claims: sub, jti, tenant_id activo)
   │
   ├─ TenantContextGuard:
   │       1. Lee tenant_id del JWT (solo como pista)
   │       2. Carga principal DESDE BD (membership activa + user status + rol)
   │       3. Si membership inactiva/inexistente → 401/403
   │       4. Crea TenantContext{tenantId, userId, role, source:'HTTP_JWT'}
   │       5. Lo fija en AsyncLocalStorage
   │
   └─ Controller → ApplicationService(repo) → Prisma
              │                              │
              └── context disponible ────────┘
                        Opción RLS (Fase 2):
                        transacción inicia
                        SET LOCAL app.set_tenant_id = :tenantId
```

Regla: la BD es la fuente de verdad (membership, rol, estado del usuario). El JWT identifica la sesión; no autoriza por claims (ADR-005).

# 5. Flujo 2 — Webhook → Queue → Worker → Application → DB

```text
Meta
 │  POST /v1/webhooks/whatsapp (firma validada, dedup temprano)
 ▼
WebhookController
 │  1. Verificar firma (X-Hub-Signature-256 / hub.challenge)
 │  2. Identificar tenant por el número destinatario (mapeo WhatsAppAccount)
 │  3. NUNCA tomar tenant del body del webhook
 │  4. Persistir/dedup (Fase 2) con provider_event_id único
 ▼
BullMQ job  payload: { providerEvent, tenantId }
 │                          ▲
 ▼                          │  (tenant explícito en el job)
Worker (proceso distinto, sin JWT)
 │
 ├─ WorkerContextMiddleware:
 │    1. Lee job.payload.tenantId
 │    2. VALIDA: tenant existe y está activo (consulta BD)
 │    3. Crea TenantContext{tenantId, source:'WORKER_JOB'}
 │    4. Fija en AsyncLocalStorage (nuevo contexto por job)
 │
 └─ ConversationEngine → LLM → Tools → ApplicationService → Prisma
              │                                    │
              └──────── context disponible ────────┘
```

Regla: **los workers no dependen de JWT.** El `tenantId` viaja en el job, se valida antes de ejecutar el caso de uso y se convierte en context. Si falta o no valida → el job falla (no se ejecuta a ciegas).

# 6. Flujo 3 — LLM → Tool → Application → DB

```text
Conversación (tenant A)
   │
   ▼
LLM decide invocar una Tool (p. ej. consultar_disponibilidad)
   │
   ▼
ToolExecutor
   │  1. Recibe JSON del LLM (inputs candidatos del modelo)
   │  2. Valida contra input schema estricto (los inputs de llave no vienen del LLM)
   │  3. Inyecta TenantContext (heredado de la conversación: tenantId = conversation.tenant_id)
   │  4. Invoca ApplicationService/ApplicationService de dominio
   │
   ▼
SchedulingService → Prisma (transacción) → PostgreSQL
```

Regla: el LLM **nunca** lleva el tenant ni ejecuta SQL (PROJECT_CONTEXT §15, §17). La Tool ejecuta en el context de la conversación y con autorización definida por Tool (ADR futuro de tool-calling).

# 7. Contextos sin tenant

- `SYSTEM`: operaciones internas (super-admin, jobs de mantenimiento, migraciones). No puede tocar datos tenant-scoped sin especificar y validar un `tenantId` explícito.
- Autenticación pública (login, register, refresh, accept-invitation antes de pertenecer): no requieren tenant, operan en tablas globales/system-scoped.

# 8. Validación del contexto

Reglas mínimas, siempre:

1. El contexto debe existir para toda operación tenant-scoped; si falta → error 500/400 de infraestructura, nunca query global.
2. `source='WORKER_JOB'|'WEBHOOK'` debe validar el tenant contra BD antes de ejecutar.
3. `source='TOOL'` hereda de la conversación; su `tenantId` debe concordar con la conversación verificada.
4. Nunca confiar en `tenant_id` del body/query/header de un request.
5. Bajo RLS, el `SET LOCAL` ocurre en la misma transacción que la operación (se revierte con el rollback).

# 9. Implementación prevista

- `TenantContextModule` con `TenantContextService` (AsyncLocalStorage) y helpers (`getContext`, `requireTenant`, `requireRole`).
- Guards: `JwtAuthGuard` (identidad), `TenantContextGuard` (principal + membership + contexto), `RolesGuard` (autorización por rol).
- Soporte para workers: middleware/helper por job que fija contexto antes del handler de BullMQ.
- Interceptor de logs que agrega `tenant_id`/`user_id`/`request_id` a pino desde el context activo.