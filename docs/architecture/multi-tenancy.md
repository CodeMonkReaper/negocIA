# 1. Objetivo

Definir la estrategia multi-tenant del SaaS: modelo de datos, clasificación de tablas, determinación del tenant desde el contexto autenticado, y cómo se combina con RLS como segunda capa.

# 2. Principios

- **Shared database + shared schema + columna `tenant_id`.** No se crea una BD ni un schema por tenant en el MVP.
- Toda entidad tenant-scoped tiene `tenant_id` NOT NULL y se consulta siempre filtrada por el tenant activo del contexto.
- El tenant **nunca** se toma del frontend (nada de `?tenant_id=...`):
  ```text
  JWT → User → Membership → Tenant → Authorization → Query
  ```
- Los usuarios pueden pertenecer a **múltiples tenants** con **roles distintos** por tenant (`User → Memberships → Tenants`).
- Cada tenant es un aislamiento lógico. RLS es una segunda capa de defensa (ADR-006).

# 3. Modelo de identidad

```text
tenants (global)
   1
   │
   ├── memberships (tenant-scoped)   ←── unique(tenant_id, user_id)
   │       1
   │       │
users (global)
```

- `users` es global (identidad compartida entre tenants de la misma persona).
- `memberships` es la fila que otorga a un `user_id` un `role` dentro de un `tenant_id`.
- El "tenant activo" en una sesión identifica la membership sobre la que se opera.

# 4. Clasificación de tablas

| Tabla | Clase | RLS (cuando se active) |
|---|---|---|
| `tenants` | Global | Política de perfil mínima (solo tu propio tenant). |
| `users` | Global | Política: solo tu propio perfil. |
| `memberships` | **Tenant-scoped** | Política híbrida: tenant context **o** `user_id = usuario actual` (necesaria para switch-tenant). |
| `refresh_tokens` | System-scoped | Sin política sobre identidad (rol con bypass). |
| `invitations` | **Tenant-scoped** | Política por tenant context. |
| `verification_tokens` | System-scoped | Sin política sobre identidad; operaciones internas. |
| Fase 2+: `conversations`, `messages`, `customers`… | **Tenant-scoped** | Política por tenant context. |

**Reglas de clasificación:**
- **Global:** existe a nivel de producto; identidad o catálogo global. No contiene datos operativos de un tenant.
- **Tenant-scoped:** pertenece a exactamente un tenant; obligatoria columna `tenant_id` + índice.
- **System-scoped:** interna al funcionamiento del sistema (sesiones, tokens), no expuesta a lógica de negocio de tenants; se accede con contexto SYSTEM.

# 5. Tenant context

El medio por el cual cada operación conoce el tenant se llama **TenantContext**. Detalle y propagación en `architecture/tenant-context.md`.

Resumen:

| Fuente | Cómo se obtiene el tenant |
|---|---|
| HTTP autenticado | Claim `tenant_id` del JWT → validado contra membership activa en BD. |
| BullMQ worker | `job.payload.tenantId` explícito → validado antes del caso de uso. |
| Webhook | Firma Meta + mapeo número/cuenta → tenant → se enqueuea el job con `tenantId`. |
| Tool (LLM) | `conversation.tenant_id` (heredado del contexto de la conversación). |
| Procesos internos | Contexto `SYSTEM`; sin tenant implícito. |

# 6. Reglas de consulta tenant-scoped

1. Toda query sobre tabla tenant-scoped incluye `tenant_id = <tenant activo>`.
2. Los repositorios/servicios exponen APIs que reciben el `TenantContext`, no un `tenant_id` arbitrario.
3. El guard de aplicación valida que el principal esté activo en el tenant, con su rol, **desde la BD** (sin confiar en claims del JWT).
4. Bajo RLS (Fase 2), el `tenant_id` se inyecta como setting de sesión (`app.set_tenant_id`) en la transacción y las políticas refuerzan lo mismo.

# 7. Multi-membership y switch-tenant

- Un usuario puede tener varias memberships activas.
- El endpoint `POST /v1/auth/switch-tenant` cambia el `tenant_id` activo del JWT, previamente validando que la membership exista y esté activa.
- El JWT expirado/rotado no es fuente de permisos: al resolver el principal se relee la membership actual (ADR-005).

# 8. Consideraciones con RLS

La activación es progresiva (ADR-006). Para no romper el modelo, toda tabla tenant-scoped diseñada en Fase 1 debe:

1. tener `tenant_id` NOT NULL con índice;
2. operar siempre con el tenant del contexto;
3. poder ejecutarse bajo una política `FORCE = tenant_id = app.get_tenant_id()` sin cambios de código — lo que implica que el `SET LOCAL app.set_tenant_id` se ejecute en la misma transacción de cada caso de uso.