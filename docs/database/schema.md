# 1. Objetivo

Definir el modelo de datos de Fase 1: tablas, columnas, relaciones, constraints, índices, ciclos de vida y clasificación de tenencia. Este esquema se materializa en migraciones versionadas (Prisma → SQL) y es la **fuente de verdad** (ADR-002).

# 2. Clasificación de tenencia

| Clase | Descripción | Tablas |
|---|---|---|
| Global | Identidad/catálogo de producto, no operativa de un tenant | `tenants`, `users` |
| Tenant-scoped | Pertenece a un tenant; obliga `tenant_id` | `memberships`, `invitations` |
| System-scoped | Interna al sistema (sesiones, tokens) | `refresh_tokens`, `verification_tokens`, `password_reset_tokens` |

# 3. Tabla `tenants` (global)

```text
Columnas:
  id          uuid PK (gen_random_uuid)
  slug        text NOT NULL UNIQUE (identificador para URLs; normalizado lower)
  name        text NOT NULL
  plan        text NOT NULL DEFAULT 'BASIC'   -- valor ENUM: BASIC|PRO|PREMIUM
                                              -- solo metadato; las reglas de límites
                                              -- viven en LimitsService (ADR-007)
  status      text NOT NULL DEFAULT 'ACTIVE'  -- ENUM: ACTIVE|SUSPENDED|CLOSED
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()

Constraints:
  PK tenants(id)
  UNIQUE tenants(slug)
  CHECK slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$'
  CHECK plan IN ('BASIC','PRO','PREMIUM')
  CHECK status IN ('ACTIVE','SUSPENDED','CLOSED')

Índices:
  UNIQUE (slug)
```

# 4. Tabla `users` (global)

```text
Columnas:
  id                 uuid PK
  email              citext NOT NULL UNIQUE   -- o text + index lower(email)
  password_hash      text NOT NULL            -- hash Argon2id; nunca crudo
  name               text NOT NULL
  status             text NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE|DISABLED
  email_verified_at  timestamptz NULL
  created_at         timestamptz NOT NULL DEFAULT now()
  updated_at         timestamptz NOT NULL DEFAULT now()

Constraints:
  PK users(id)
  UNIQUE users(email)          [con índice en lower(email) si no se usa citext]
  CHECK status IN ('ACTIVE','DISABLED')

Índices:
  UNIQUE (email)
```

# 5. Tabla `memberships` (tenant-scoped)

```text
Columnas:
  id          uuid PK
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
  role        text NOT NULL       -- ENUM: OWNER|ADMIN|AGENT
  status      text NOT NULL DEFAULT 'ACTIVE'   -- ACTIVE|INACTIVE
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()

Constraints:
  PK memberships(id)
  UNIQUE (tenant_id, user_id)      -- una membership por user-tenant
  FK tenants(id) ON DELETE RESTRICT  (no borrar tenant con memberships)
  FK users(id)   ON DELETE CASCADE   (borrar user → borrar sus memberships)
  CHECK role IN ('OWNER','ADMIN','AGENT')
  CHECK status IN ('ACTIVE','INACTIVE')

Índices:
  UNIQUE (tenant_id, user_id)
  (user_id)          -- obtener tenants de un usuario (switch-tenant, /me)
  (tenant_id)        -- listar usuarios de un tenant
```

# 6. Tabla `refresh_tokens` (system-scoped)

```text
Columnas:
  id                     uuid PK
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
  session_id             uuid NOT NULL           -- ancla de la familia (session_id === id en la raíz)
  tenant_id              uuid NOT NULL           -- tenant activo de la sesión; reconstruye el contexto al renovar
  token_hash             text NOT NULL UNIQUE     -- SHA-256 del token opaco
  expires_at             timestamptz NOT NULL
  revoked_at             timestamptz NULL
  replaced_by_token_id   uuid NULL REFERENCES refresh_tokens(id) ON DELETE SET NULL
  ip                     text NULL
  user_agent             text NULL
  created_at             timestamptz NOT NULL DEFAULT now()

Constraints:
  PK refresh_tokens(id)
  UNIQUE (token_hash)
  UNIQUE (replaced_by_token_id)    -- un token solo puede ser remplazado una vez
  FK users(id) ON DELETE CASCADE

Índices:
  UNIQUE (token_hash)
  (user_id) WHERE revoked_at IS NULL      -- sesiones activas del usuario
  (session_id)                            -- revocar/auditar toda una familia
  (tenant_id)                             -- tenant de las sesiones renovadas
  (expires_at)                            -- limpieza de expirados
  (user_id, expires_at)
```

Notas: `replaced_by_token_id` encadena la familia de refrescos (soporta detección de reuse y revocación de familia). El token crudo (opaco, ~48 bytes aleatorios) se envía una sola vez; en BD solo su hash. La tabla es system-scoped (operada por el sistema, sin RLS), pero `tenant_id` es dato de negocio: como el access token solo vive 15 min, la fila de refresco es lo único que permite reconstruir el tenant cuando un cliente renueva una sesión caducada. `session_id` identifica la sesión completa (raíz primero y sus reemplazos); en la raíz se cumple `session_id === id`, y no hay FK hacia `id` a propósito para no impedir borrar la raíz con descendientes (ver `schema.prisma` §`RefreshToken`).

# 7. Tabla `invitations` (tenant-scoped)

```text
Columnas:
  id           uuid PK
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  email        citext NOT NULL           -- email normalizado del invitado
  role         text NOT NULL             -- ENUM: OWNER|ADMIN|AGENT (rol propuesto)
  invited_by   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  token_hash   text NOT NULL UNIQUE      -- SHA-256 del token de 1-uso
  status       text NOT NULL DEFAULT 'PENDING'
               -- ENUM: PENDING|ACCEPTED|EXPIRED|REVOKED
  expires_at   timestamptz NOT NULL
  accepted_at  timestamptz NULL
  accepted_by  uuid NULL REFERENCES users(id) ON DELETE SET NULL
  revoked_at   timestamptz NULL
  created_at   timestamptz NOT NULL DEFAULT now()

Constraints:
  PK invitations(id)
  UNIQUE (token_hash)
  FK tenants(id) ON DELETE CASCADE
  CHECK status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')
  CHECK role IN ('OWNER','ADMIN','AGENT')
  CHECK (accepted_at IS NULL) = (accepted_by IS NULL)   -- ambos o ninguno

Índices:
  UNIQUE (token_hash)
  (tenant_id)                          -- listar invitaciones de un tenant
  (email)                              -- el usuario encuentra su invitación
  (status, expires_at)                 -- job de expiración de invitaciones
```

Invariantes de negocio (reforzadas en aplicación):
- No se pueden crear **dos** invitaciones PENDING al mismo email en el mismo tenant (unique parcial `(tenant_id, email) WHERE status='PENDING'`), ni invitar a un email que ya es miembro del tenant. Se valida en servicio + constraint parcial como defensa.

# 8. Tabla `verification_tokens` (system-scoped)

```text
Columnas:
  id           uuid PK
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
  token_hash   text NOT NULL UNIQUE
  expires_at   timestamptz NOT NULL
  used_at      timestamptz NULL
  created_at   timestamptz NOT NULL DEFAULT now()

Constraints:
  PK verification_tokens(id)
  UNIQUE (token_hash)

Índices:
  UNIQUE (token_hash)
  (user_id)
```

Consumo 1-uso: `UPDATE verification_tokens SET used_at=now() WHERE id=:id AND token_hash=:hash AND used_at IS NULL AND expires_at > now()` afectando 0 filas → inválido. Aceptación establece `users.email_verified_at`.

# 9. Tabla `password_reset_tokens` (system-scoped)

```text
Columnas:
  id           uuid PK
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
  token_hash   text NOT NULL UNIQUE      -- SHA-256 del token de reset de 1-uso
  expires_at   timestamptz NOT NULL      -- 15 min (RESET_TOKEN_TTL_SECONDS)
  used_at      timestamptz NULL          -- consumido (o invalidado) si está set
  created_at   timestamptz NOT NULL DEFAULT now()

Constraints:
  PK password_reset_tokens(id)
  UNIQUE (token_hash)
  FK users(id) ON DELETE CASCADE

Índices:
  UNIQUE (token_hash)
  (user_id)                       -- invalidar pendientes del usuario al emitir/cambiar
```

Notas: mismo patrón que `verification_tokens` (token crudo solo por email, hash en BD, consumo atómico 1-uso), pero con dominio y TTL propios (15 min vs 24 h) — decisión de ADR-009. Solo puede existir un reset pendiente por usuario: al emitir uno nuevo se invalidan los anteriores (`used_at = now()`), y un reset exitoso invalida los pendientes restantes.

# 10. Tablas `whatsapp_accounts` y `whatsapp_events` (tenant-scoped / global, F2-3)

Gestionadas por `modules/whatsapp` (webhook + alta manual de cuentas, ADR-010). Los eventos son
la única tabla hasta ahora cuya clave de idempotencia (`provider_event_id`) es **global**: los
ids de Meta (`wamid.*`…) son únicos entre tenants.

```text
whatsapp_accounts (tenant-scoped):
  id               uuid PK
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
  waba_id          text NOT NULL           -- WhatsApp Business Account de Meta
  phone_number_id  text NOT NULL           -- número; el webhook resuelve el tenant por él
  display_phone    text NULL
  access_token_encrypted jsonb NULL        -- cifrado AES-256-GCM (EncryptedPayload); nunca en claro
  status           text NOT NULL DEFAULT 'ACTIVE'
  created_at       timestamptz NOT NULL DEFAULT now()
  updated_at       timestamptz NOT NULL DEFAULT now()

  UNIQUE (tenant_id, waba_id)
  UNIQUE (tenant_id, phone_number_id)
  INDEX (tenant_id)
  CHECK (status IN ('ACTIVE','DISABLED'))

whatsapp_events (global idempotencia, tenant/account NULL si el tenant no existe):
  id                uuid PK
  provider_event_id text NOT NULL UNIQUE   -- wamid.* de Meta; dedup del webhook
  tenant_id         uuid NULL REFERENCES tenants(id) ON DELETE SET NULL
  account_id        uuid NULL REFERENCES whatsapp_accounts(id) ON DELETE SET NULL
  event_type        text NOT NULL          -- message:text, statuses, …
  payload           jsonb NOT NULL
  status            text NOT NULL DEFAULT 'RECEIVED'
  created_at        timestamptz NOT NULL DEFAULT now()
  processed_at      timestamptz NULL

  UNIQUE (provider_event_id)               -- la UNIQUE es la fuente de idempotencia
  INDEX (tenant_id), INDEX (account_id)
  INDEX (status, created_at)               -- barridos de reintentos (FAILED/RECEIVED)
  CHECK (status IN ('RECEIVED','ENQUEUED','PROCESSED','FAILED','DEDUPLICATED'))
```

Notas: el acceso al webhook está protegido por la firma HMAC del body crudo; `access_token` no
se loguea ni se devuelve en respuestas (su gestión de secretos es F7-D3). Transiciones de estado
idempotentes en repositorio: `markEnqueued/markProcessed/markFailed` usan `updateMany` con el
status anterior en el `where`; un evento `ENQUEUED/PROCESSED/DEDUPLICATED` no vuelve atrás.

# 11. Tablas `conversations` y `messages` (tenant-scoped, F2-4)

Gestionadas por `modules/conversations` (dominio: `domain/conversations`, ADR-010 continúa). El
worker de WhatsApp escribe aquí los mensajes entrantes; la API los lee (inbox del agente). La
máquina de estados (`state-machine.ts`) define las transiciones; F2-4 solo produce `BOT_ACTIVE`
(traspaso a humano en F6-3).

```text
conversations (tenant-scoped):
  id               uuid PK
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
  account_id       uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE RESTRICT
  customer_wa_id   text NOT NULL          -- wa_id del cliente en Meta
  customer_name    text NULL              -- profile.name del primer contacto conocido
  status           text NOT NULL DEFAULT 'BOT_ACTIVE'
  last_message_at  timestamptz NULL
  created_at       timestamptz NOT NULL DEFAULT now()
  updated_at       timestamptz NOT NULL DEFAULT now()

  UNIQUE (tenant_id, account_id, customer_wa_id)  -- una conversación por cliente y cuenta
  INDEX (tenant_id, status, last_message_at)      -- inbox por estado + orden
  CHECK (status IN ('BOT_ACTIVE','HUMAN_REQUESTED','HUMAN_ACTIVE','CLOSED'))

messages (tenant-scoped; provider_message_id global UNIQUE):
  id                   uuid PK
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT
  conversation_id      uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE
  provider_message_id  text NOT NULL UNIQUE   -- wamid.* de Meta; dedup en escritura
  direction            text NOT NULL
  type                 text NOT NULL          -- tipo reportado por Meta (text, image, …)
  content              text NULL              -- text.body / caption
  delivery_status      text NULL              -- statuses[].status de Meta
  metadata             jsonb NULL             -- objeto crudo del mensaje
  created_at           timestamptz NOT NULL DEFAULT now()
  updated_at           timestamptz NOT NULL DEFAULT now()

  INDEX (tenant_id)
  INDEX (conversation_id, created_at)          -- historial cronológico por conversación
  CHECK (direction IN ('INBOUND','OUTBOUND'))
  CHECK (delivery_status IN ('accepted','queued','sent','delivered','read','failed','deleted'))
```

Notas: **idempotencia en escritura** — la UNIQUE `messages(provider_message_id)` es la frontera
que hace el reintento de un job (BullMQ at-least-once) un no-op: `recordInboundMessage` corre
dentro de una transacción y, si el `wamid` ya existe, el P2002 la deshace entera (incluida la
conversación recién creada) y devuelve `"duplicated"`. `assigned_user_id` y `mode` se añaden en
F6-3 (traspaso a humano); el id interno de cliente (`customer_id`) en F6 (modelo de contactos).

# 12. Convenciones globales

1. **IDs**: `uuid` generados en BD (`gen_random_uuid()`).
2. **Timestamps**: `timestamptz`; `updated_at` se actualiza en aplicación o trigger (decisión: por aplicación, para evitar triggers excesivos).
3. **Soft vs hard delete**:
   - `users`/`tenants`: soft (status/CLOSED). Borrado físico prohibido en normalidad.
   - `memberships`/`invitations`: soft (status). `invitations.revoked_at`.
   - `refresh_tokens`/`verification_tokens`/`password_reset_tokens`: **hard delete** vía job de limpieza (tokens expirados/revocados > N días). Son efímeros.
4. **citext vs lower(email)**: se prefiere `citext` (extensión) para una comparación case-insensitive correcta; si no es posible, `text` + `CREATE UNIQUE INDEX ON users(lower(email))`.
5. **Naming**: singular, snake_case, `created_at`/`updated_at` en todas las filas persistentes.
6. **Migraciones**: versionadas (Prisma `migrate`). SQL raw permitido para: exclusion constraints (agenda, Fase 5), índices GiST, partial unique, extensiones (`citext`, futura `btree_gist`).

# 13. RLS (preparación, activación Fase 2 — ADR-006)

Al activar RLS por tabla:

- Rol de aplicación tenant: `app_tenant` (tiene RLS activa); rol de migraciones: `app_migrator` (BYPASSRLS).
- Inyección: `SET LOCAL app.set_tenant_id` en la transacción.
- Políticas previstas:
  - `memberships`: `tenant_id = app.get_tenant_id() OR user_id = app.get_user_id()`.
  - `invitations`: `tenant_id = app.get_tenant_id()`.
  - `tenants`/`users`: perfil propio / propio tenant (mínimas).
  - `refresh_tokens`/`verification_tokens`/`password_reset_tokens`: operadas por rol con bypass (system).
- Orden de activación: 1) domain tables que nacen nuevas, 2) `invitations`, 3) `memberships`, 4) `users`/`tenants`, 5) tablas de sistema (con rol dedicado).

# 14. Auditoría (previsión Fase 2)

`audit_logs` (id, actor_user_id, actor_tenant_id, action, entity_type, entity_id, metadata jsonb, created_at) para invariables sensibles. Los campos `invited_by`/`accepted_by` ya cubren invitaciones en Fase 1.