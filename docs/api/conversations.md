# API de Conversaciones y Mensajes (F2-4)

Base: `/api/v1/conversations`. Autenticado con bearer (`docs/architecture/authentication.md` §7);
rol mínimo **AGENT** (jerárquico: AGENT, ADMIN u OWNER) — el Agente de Atención es el consumidor
natural del inbox. Todas las consultas se filtran por el `tenant_id` del `Principal`; un id ajeno
responde **404 "no existe"**, nunca 403, para no revelar existencia (mismo criterio que
`docs/api/webhooks.md` §3 / `docs/architecture/tenant-context.md`).

La escritura de **mensajes entrantes** la hace el worker de WhatsApp (`pnpm start:worker`) a partir de
`whatsapp_events`. La escritura de **mensajes salientes (OUTBOUND)** ocurre vía
`POST /api/v1/conversations/:id/messages` (envío real a Meta Cloud API con cifrado de token).
Estados definidos en `docs/database/schema.md` §11.

# 1. `GET /api/v1/conversations` — bandeja del tenant

```text
GET /api/v1/conversations?limit=20&offset=0&status=BOT_ACTIVE
```

- `limit` 1–100 (default 20); `offset` ≥ 0 (default 0).
- `status` opcional; filtra por `BOT_ACTIVE | HUMAN_REQUESTED | HUMAN_ACTIVE | CLOSED`.
  Cualquier otro valor → **400** `validation_error`.
- Orden: `last_message_at` desc (nulas al final), luego `created_at` desc.

```jsonc
// 200
{
  "items": [{
    "id": "uuid",
    "customerWaId": "573100000001",
    "customerName": "María Peña",
    "status": "BOT_ACTIVE",
    "lastMessageAt": "2026-10-04T12:00:00.000Z",
    "createdAt": "2026-10-04T12:00:00.000Z",
    "updatedAt": "2026-10-04T12:00:00.000Z"
  }],
  "total": 1
}
```

# 2. `POST /api/v1/conversations/:id/messages` — enviar mensaje saliente (OUTBOUND)

```text
POST /api/v1/conversations/:id/messages
Content-Type: application/json
Authorization: Bearer <token>
```

```jsonc
{
  "text": "Hola, ¿en qué puedo ayudarte?"
}
```

- Requiere rol mínimo **AGENT** (OWNER/ADMIN/AGENT). 
- `:id` debe ser un UUID → si no, **400** `validation_error`.
- `text` obligatorio, 1–4096 caracteres → inválido → **400** `validation_error`.
- Si la conversación no existe o pertenece a otro tenant → **404** `not_found`.
- Envío vía Meta Cloud API (`WHATSAPP_PROVIDER=real`) usando `phone_number_id` de la cuenta y `access_token` **descifrado** (AES-256-GCM). Error de proveedor → **502** `external_provider_error`.
- Persiste mensaje con `direction=OUTBOUND`, `status=SENT`, `provider_message_id` devuelto por Meta (o generado). Actualiza `conversation.last_message_at`.

```jsonc
// 201
{
  "id": "uuid",
  "direction": "OUTBOUND",
  "type": "text",
  "content": "Hola, ¿en qué puedo ayudarte?",
  "deliveryStatus": "SENT",
  "createdAt": "2026-10-04T12:00:05.000Z"
}
```

# 3. `GET /api/v1/conversations/:id/messages` — historial de una conversación

```text
GET /api/v1/conversations/:id/messages?limit=20&offset=0
```

- `:id` debe ser un uuid → si no, **400** `validation_error`.
- Si la conversación no existe o pertenece a otro tenant → **404** `not_found`.
- Orden cronológico ascendente (`created_at`).

```jsonc
// 200
{
  "items": [{
    "id": "uuid",
    "direction": "INBOUND",
    "type": "text",
    "content": "Hola",
    "deliveryStatus": null,
    "createdAt": "2026-10-04T12:00:00.000Z"
  }],
  "total": 2
}
```

# 4. Semántica de datos

- `providerMessageId` es el `wamid` de Meta y **nunca** se expone en respuestas (identificador
  externo de integración, no de negocio).
- `direction` `INBOUND` (cliente → negocio; lo escribe el worker) u `OUTBOUND` (negocio → cliente;
  enviado vía `POST /api/v1/conversations/:id/messages` con Meta Cloud API).
- `content` es `text.body` o la caption para medios; `null` si el tipo no lleva texto.
- `metadata` interna del mensaje no viaja en respuestas HTTP (se puede consultar vía BD para
  diagnóstico de F3-3).