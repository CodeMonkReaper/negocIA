# API de Webhooks de WhatsApp (F2-3)

Base de webhook: `/api/webhooks`. Estas rutas son **públicas** (Meta no envía bearer) y viven
fuera del prefijo autenticado `v1`. Errores de webhook con `{ error: código, message }`; ver
`docs/architecture/whatsapp.md` y ADR-010.

# 1. `GET /api/webhooks/whatsapp` — handshake de suscripción

Meta verifica la propiedad del endpoint al configurar el webhook.

```text
GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…&hub.lease_seconds=…
```

- `hub.mode !== "subscribe"` o `hub.verify_token` incorrecto → **403** `webhook_verification_failed`.
- Éxito → **200** con el `hub.challenge` como **text/plain** (Meta solo acepta el string, no un JSON wrapper).
- Comparación del token timing-safe (no es un oráculo de cuándo falla).

# 2. `POST /api/webhooks/whatsapp` — ingestión de eventos

```text
POST /api/webhooks/whatsapp
X-Hub-Signature-256: sha256=<hmac-sha256 hex del body crudo>
Content-Type: application/json

{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "…", "phone_number_id": "5730…" },
        "contacts": [ { "profile": { "name": "…" }, "wa_id": "…" } ],
        "messages": [ { "from": "…", "id": "wamid.…", "timestamp": "…", "type": "text", "text": { "body": "…" } } ]
      }
    }]
  }]
}
```

### Comportamiento

| Condición | Respuesta |
|---|---|
| Firma `X-Hub-Signature-256` ausente/incorrecta | **401** (reporte vacío; Meta no verá eventos con firma rota) |
| JSON malformado | **200** con reporte vacío (no entrar en bucle de reintento) |
| payload sin `entry[].changes[]`, cuenta sin registrar, evento irrecuperable | **200**, `ignored` / `duplicated` (sin fila o sin efecto) |
| evento nuevo | `create RECEIVED` → enqueue → 200 `{ received, ignored, duplicated }` |
| enqueue falla | `markFailed` + **502** `external_provider_error` (Meta reintentará y el redelivery re-encola) |

- El body se lee **crudo** (`rawBody: true`) exclusivamente para verificar la firma HMAC-SHA256.
- `@HttpCode(200)` explícito: el default 201 de Nest haría reintentos de Meta.
- `@Throttle` propio de 600/60s (Meta puede entregar rachas).

### Respuesta 200 (reporte de ingestión)

```jsonc
// 200
{ "received": 1, "ignored": 0, "duplicated": 0 }
```

### Idempotencia

`provider_event_id` con UNIQUE en `whatsapp_events`: un redelivery de un evento ya
`ENQUEUED/PROCESSED/DEDUPLICATED` es no-op (200); los `FAILED` sí se re-encolan (retryable).
La cola añade una segunda barrera con `jobId = providerEventId`.

# 3. `POST /api/v1/whatsapp/accounts` — alta manual de cuenta

Rol **OWNER**. Cuerpo:

```jsonc
{ "wabaId": "123456789", "phoneNumberId": "573001234567", "displayPhone": "+57 300 123 4567" }
```

- `accessToken` se envía en el body (8–512 chars) y **nunca** en respuestas.
- 201 → `{ "id", "wabaId", "phoneNumberId", "displayPhone", "status": "ACTIVE", "createdAt" }`.
- 409 `conflict` si `(tenant, wabaId)` o `(tenant, phoneNumberId)` ya existe.
- El webhook resuelve el `tenant_id` del evento desde `phone_number_id`.

# 4. `GET /api/v1/whatsapp/accounts`

Lista las cuentas del tenant activo (rol OWNER); nunca incluye `accessToken`.

# 5. Errores

Catálogo de `webhook`: 403 `webhook_verification_failed` (verify_token mal), 401 (firma), 502
`external_provider_error` (fallo de cola). El resto sigue el catálogo canónico
(`conflict`, `validation_error`, `forbidden`, …).