# M9 — Embedded Signup + envío real de WhatsApp + cifrado de access_token

| Campo | Valor |
|---|---|
| Hito | M9 (F2-3/F2-4 ampliación) |
| Fecha | 03/10/2026 |
| Estado | **Completo** en código (implementado, pendiente de tests/documentación sincronizada) |
| Referencias normativas | `docs/architecture/whatsapp.md`, `docs/api/whatsapp.md`, `docs/api/conversations.md`, `docs/database/schema.md` §11, `PROJECT_CONTEXT.md` §24 (F2-3 parcial), ADR-012 (propuesto), `packages/config/src/crypto.ts`, `packages/database/prisma/schema.prisma` (migración 20261003233113) |

## 1. Contexto y objetivo

El canal entrante de WhatsApp (M7) quedó operativo con cuentas conectadas manualmente. El diseño original (legacy §13/#17) contempla **Embedded Signup (OAuth de Meta)** para automatizar la incorporación de cuentas WABA y **envío real de mensajes** (OUTBOUND) para cerrar el bucle conversación→respuesta.

También se detectó la necesidad de **cifrar el `access_token` a nivel de almacenamiento** (never store in clear). El código implementa AES-256-GCM vía `CryptoService` y columna `access_token_encrypted` (JSONB).

Este hito consolida esa superficie ya **implementada** en código:

1. **Embedded Signup (OAuth)**: generación de URL de autorización Meta (Business Login) + callback público para intercambiar `code`/`state` por token y guardar cuenta WABA cifrada.
2. **Envío real (OUTBOUND)**: proveedor Meta Cloud API (`MetaCloudProvider`) + mock, expuesto vía `POST /api/v1/conversations/:id/messages` con validación y control cross-tenant.
3. **Cifrado de access_token**: `CryptoService.encrypt/decrypt` (AES-256-GCM), `ENCRYPTION_KEY` obligatorio cuando `META_DRIVER=real`, migración `20261003233113_add_encrypted_access_token`.

## 2. Alcance (implementado)

### 2.1 Embedded Signup
- `MetaOAuthClient` (`infrastructure/whatsapp/meta-oauth.ts`): construye URL con `client_id`, `redirect_uri`, `state` (nonce), `scope=business_management,whatsapp_business_management,whatsapp_business_messaging`; intercambio `code→access_token` (Graph API v21.0).
- `EmbeddedSignupService` (`modules/whatsapp/application/embedded-signup.service.ts`): valida `state`, intercambia token, persiste `WhatsappAccount` con `access_token_encrypted` (AES-256-GCM), estado `ACTIVE`, vínculo a tenant (OWNER autorizado). Requiere `JWT_SECRET` para validar/verificar state (nota: usa `process.env.JWT_SECRET` directamente; puede migrarse a `ConfigService` en refactor).
- Rutas (`modules/whatsapp/presentation/whatsapp-accounts.controller.ts`):
  - `GET /api/v1/whatsapp/accounts/embedded-signup/url` — roles OWNER/ADMIN/AGENT (auth + tenant). Retorna `{url, state}` (DTO `EmbeddedSignupUrlResponseDto`).
  - `GET /api/v1/whatsapp/accounts/embedded-signup/callback` — **público** (`@Public`), sin auth. Recibe `code,state,error` vía query. Respuesta: HTML inline + `postMessage` al opener (flujo popup). Errores mapeados a `EmbeddedSignup*` (`domain/errors/index.ts`: `EmbeddedSignupStateMismatchError(400)`, `EmbeddedSignupCodeExchangeError(502)`, `EmbeddedSignupMissingTokenError(502)`, `EmbeddedSignupAccountConflictError(409)`, `EmbeddedSignupValidationError(400)`, `EmbeddedSignupOAuthError(502)`, `EmbeddedSignupInvalidRequestError(400)`).

### 2.2 Envío real (OUTBOUND)
- `MetaCloudProvider` (`infrastructure/whatsapp/meta-cloud-provider.ts`): `sendTextMessage({to, text, phoneNumberId})` llama a Graph API `/{phone-number-id}/messages` con `recipient_type=individual`, `message_type=text`. Decodifica errores Meta y mapea a `ExternalProviderError`.
- `MockWhatsAppProvider` (`infrastructure/whatsapp/mock-whatsapp-provider.ts`): stub determinista para dev/test.
- `whatsapp-provider.factory.ts`: crea provider según `META_DRIVER` (mock/real). Exporta `WHATSAPP_PROVIDER` token.
- `ConversationsService.sendMessage(conversationId, {text})` (`modules/conversations/application/conversations.service.ts:110-166`): valida tenant (404 si ajeno), obtiene `phone_number_id` + `access_token` descifrado (AES-256-GCM vía `CryptoService.decrypt`), llama a `WHATSAPP_PROVIDER.sendTextMessage`, persiste `Message` con `direction=OUTBOUND`, `status=SENT`, `provider_message_id` devuelto por Meta (o generado), actualiza `last_message_at`. Errores: `NotFoundError(404)` cross-tenant, `ExternalProviderError(502)` si falla proveedor.
- Ruta: `POST /api/v1/conversations/:id/messages` (`modules/conversations/presentation/conversations.controller.ts:96`) — roles OWNER/ADMIN/AGENT. Body `{text: string}` (1–4096). Retorna `MessageResponseDto`.

### 2.3 Cifrado de access_token
- `CryptoService` (`packages/config/src/crypto.ts`): AES-256-GCM, genera `iv` aleatorio + `authTag`, serializa `{iv, authTag, ciphertext}` como base64/JSON (`EncryptedPayload`). Requiere `ENCRYPTION_KEY` de 32 bytes (base64) cuando aplica cifrado con `META_DRIVER=real`.
- `packages/database/prisma/schema.prisma`: `WhatsappAccount.access_token_encrypted` `Json?` (nullable), `access_token` removido/reestructurado en migración `20261003233113_add_encrypted_access_token`.
- `WhatsappAccountsService`/repos persist/read usan payload cifrado; descifrado solo en lectura para enviar (`ConversationsService.sendMessage`, `EmbeddedSignupService` según flujo).
- `ApiEnv` valida `ENCRYPTION_KEY`: requerido si `META_DRIVER === "real"` (`api-environment.ts:351-379`).

## 3. Contratos y tipos
- `@negocia/contracts`: `EmbeddedSignupUrlResponseDto`, `WhatsappTemplateResponseDto` (tipo existente; sin implementación de templates). Errores añadidos: 7 códigos `EMBEDDED_SIGNUP_*` (`packages/contracts/src/errors.ts:27-33`) con paridad en `domain/errors/index.ts:137-189` y spec `identity-vocabulary.spec.ts:119-125`.

## 4. Variables de entorno

| Var | Obligatoria | Valor por defecto | Notas |
|---|---|---|---|
| `META_APP_ID` | Sí (si `META_DRIVER=real` y Embedded Signup) | — | App ID de Meta |
| `META_APP_SECRET` | Sí (si `META_DRIVER=real`) | — | App Secret |
| `META_EMBEDDED_SIGNUP_REDIRECT_URI` | Sí (si usa Embedded Signup) | — | Redirect URI registrado en Meta (debe coincidir exactamente) |
| `ENCRYPTION_KEY` | **Sí si `META_DRIVER=real`** | — | 32 bytes codificados en base64 (AES-256-GCM). Obligatorio en producción real. |

Ver `.env.example` (secciones "M8: Embedded Signup" y "M8.5.1: Cifrado access_token").

## 5. Decisiones de diseño
- Callback **público** (`@Public`, `@SkipThrottle`) porque el navegador del usuario (popup) no lleva cookies de API en ese redirect; validación de `state` + intercambio server-side mitiga CSRF.
- Respuesta HTML inline con `postMessage` al `window.opener` para cerrar popup y notificar éxito/error (UX simple, sin redirect a frontend).
- **Cross-tenant estricto**: todas las lecturas de conversación/account filtran por `tenant_id` (vía `TenantContext`). Acceso ajeno → `NotFoundError(404)` (nunca 403), coherente con el resto de la API.
- Idempotencia OUTBOUND: `provider_message_id` único global (`messages.provider_message_id` UNIQUE) protege reintentos; BullMQ at-least-once aplica igual patrón que inbound.
- Cifrado **at-rest**: `access_token_encrypted` (JSONB) almacena `{iv, authTag, ciphertext}`; nunca se serializa el token en claro en logs/respuestas (DTOs no lo exponen).

## 6. Exclusiones (fuera de alcance)
- Rotación de token de larga duración (60 días) y refresh de `access_token` Meta — queda para F7-D3.
- UI web del popup/flujo Embedded Signup (solo backend retorna URL + callback HTML) — F3-1.
- Templates de WhatsApp (`WhatsappTemplateResponseDto` existe pero sin endpoints/repos/servicio) — no implementado.
- Webhooks de delivery/read receipts avanzados más allá de `statuses[]` ya mapeados — M7/M8 cubren caso básico.

## 7. Estado de verificación
- Código implementado y cableado (`AppModule` importa `WhatsappModule`, `ConversationsModule` provee `WHATSAPP_PROVIDER`). 
- **Tests pendientes** (brecha identificada): unit `EmbeddedSignupService` + `MetaOAuthClient`; integration/e2e para `GET /v1/whatsapp/accounts/embedded-signup/url`, callback público (code/state/error, conflictos cross-tenant), `POST /v1/conversations/:id/messages` (404 cross-tenant, 502 provider rejection, validación texto 1–4096).
- `pnpm verify` debe ejecutarse tras añadir tests M9.

## 8. Próximo paso
Añadir cobertura de tests M9 → ejecutar `pnpm verify`. Tras verde, actualizar artefactos de documentación (README, PROJECT_CONTEXT, docs/* API/architecture/database/security/infrastructure). Luego **F3-3b (motor de conversación)**.