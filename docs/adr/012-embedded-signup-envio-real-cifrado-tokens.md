# ADR-012 — Embedded Signup, envío real de WhatsApp y cifrado de access_token (M9)

- **Estado**: Aceptado
- **Fecha**: 03/10/2026
- **Autores**: Equipo de desarrollo

## Contexto

El canal entrante (M7) opera con cuentas WABA conectadas manualmente. Para reducir fricción de onboarding (especialmente para PyMEs en LATAM) se requiere automatizar la vinculación de cuentas mediante **Embedded Signup** (OAuth de Meta Business Login). Asimismo, para cerrar el bucle de conversación, es necesario habilitar el **envío real de mensajes OUTBOUND** desde la API hacia WhatsApp Cloud API. Finalmente, los `access_token` de Meta deben almacenarse **cifrados en reposo** (requisito de seguridad operativa).

Esta superficie ya está implementada en código (M9) y esta ADR documenta las decisiones de diseño adoptadas.

## Decisión

1. **Embedded Signup (OAuth)**
   - Usar **Meta OAuth Embedded Signup** con `scope` mínimo necesario: `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`.
   - Generar `state` (nonce firmado con `JWT_SECRET`, validable server-side) para mitigar CSRF; validarlo obligatoriamente en callback.
   - Callback **público** (`@Public`, `@SkipThrottle`) porque el redirect ocurre desde navegador (popup) sin cookies de API. Toda la validación (state + intercambio token) es server-side.
   - Intercambio `code → access_token` vía Graph API v21.0 (`MetaOAuthClient`). Tratar errores Meta mapeando a errores de dominio (`EmbeddedSignup*`).
   - Persistir `WhatsappAccount` con `access_token_encrypted` (AES-256-GCM), estado `ACTIVE`, vinculado a `tenant_id` del principal autenticado que solicitó la URL. Conflictos cross-account/tenant → `EmbeddedSignupAccountConflictError(409)`.
   - Respuesta del callback: HTML inline con `postMessage` hacia `window.opener` para cerrar popup y notificar éxito/error (sin redirección forzosa a frontend).

2. **Envío real OUTBOUND**
   - `WHATSAPP_PROVIDER` abstrae proveedor (`mock`/`real`) vía factory (`whatsapp-provider.factory.ts`). En `real`: `MetaCloudProvider.sendTextMessage` invoca `/{phone-number-id}/messages` (Graph API) con `recipient_type=individual`, `message_type=text`.
   - `POST /api/v1/conversations/:id/messages` (roles OWNER/ADMIN/AGENT): valida tenant (acceso ajeno → `NotFoundError(404)`, nunca 403), obtiene `phone_number_id` y `access_token` descifrado (`CryptoService.decrypt`), envía vía proveedor, persiste `Message` `direction=OUTBOUND`, `status=SENT`, `provider_message_id` devuelto por Meta (fallback generado si ausente), actualiza `conversation.last_message_at`.
   - Errores proveedor → `ExternalProviderError(502)` (mensaje genérico al cliente; detalles no se filtran). Validación body: `text` 1–4096 caracteres.
   - Idempotencia: `messages.provider_message_id` UNIQUE protege reintentos (BullMQ at-least-once).

3. **Cifrado de access_token (at-rest)**
   - **Algoritmo**: AES-256-GCM (`packages/config/src/crypto.ts`, `CryptoService`).
   - **Formato de almacenamiento**: JSONB `{iv, authTag, ciphertext}` (`WhatsappAccount.access_token_encrypted`), serializado como `EncryptedPayload`. Nunca almacenar en claro.
   - **Clave**: `ENCRYPTION_KEY` (32 bytes, codificada en base64). **Obligatoria** cuando `META_DRIVER === "real"`. Validada en `validateEnv` (`api-environment.ts:351-379`).
   - **Alcance**: cifrado al persistir (Embedded Signup, actualización de tokens), descifrado **solo** en tiempo de ejecución para invocar Meta Cloud API (no expuesto en DTOs/respuestas/logs).

## Razones

- **Seguridad**: cifrado at-rest con AES-GCM (autenticado) reduce impacto ante fuga de BD. State + callback server-side mitiga CSRF en OAuth.
- **UX**: Embedded Signup elimina flujo manual (onboarding más ágil). Popup + `postMessage` evita redirects complejos y mantiene contexto de app.
- **Consistencia arquitectónica**: sigue patrón port-adapter (proveedor inyectado por token `WHATSAPP_PROVIDER`), cross-tenant estricto (404 indistinguible), errores de dominio canónicos, sin filtrar secretos.
- **Idempotencia**: alineado con M7/M8 (UNIQUE + at-least-once).

## Consecuencias

- **BD**: columna `access_token_encrypted` JSONB (migración `20261003233113_add_encrypted_access_token`). No existe dependencia de RLS añadida en este hito.
- **Config**: nuevas variables obligatorias condicionales (`META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_REDIRECT_URI`, `ENCRYPTION_KEY`) cuando `META_DRIVER=real`.
- **API**: 2 nuevas rutas (URL + callback público), 1 ruta existente ampliada con lógica outbound (`POST /conversations/:id/messages`).
- **Testing**: requiere mocks para Meta OAuth + Graph API; callback público debe probarse con casos `code/state/error` y conflictos cross-tenant.
- **Operación**: rotación de `access_token` Meta (larga duración 60 días) queda pendiente (F7-D3). `ENCRYPTION_KEY` debe gestionarse como secreto (no commiteado).

## Referencias

- Código: `modules/whatsapp/application/embedded-signup.service.ts`, `infrastructure/whatsapp/meta-oauth.ts`, `infrastructure/whatsapp/meta-cloud-provider.ts`, `modules/conversations/application/conversations.service.ts:110-166`, `infrastructure/whatsapp/whatsapp-provider.factory.ts`, `packages/config/src/crypto.ts`
- Contratos: `packages/contracts/src/whatsapp.ts`, `packages/contracts/src/errors.ts:27-33`
- Migración: `packages/database/prisma/migrations/20261003233113_add_encrypted_access_token/`
- Env: `packages/config/src/api-environment.ts:351-379`, `.env.example`
- Specs: `packages/contracts/src/identity-vocabulary.spec.ts:119-125`