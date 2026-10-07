# API de Autenticación, Tenants, Usuarios e Invitaciones (Fase 1)

Base: `/api/v1`. Autenticación: access JWT en `Authorization: Bearer <token>` para endpoints protegidos. Respuestas de error con `{ error: código, message, requestId? }`; ver §12.

# 1. `POST /v1/auth/register`

Registra usuario + crea tenant + membership OWNER + sesión. No requiere auth.

```jsonc
// request
{ "name": "Ana Pérez", "email": "ana@x.cl", "password": "••••••••" }

// 201
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaco>",
  "expiresIn": 900,
  "user": { "id": "…", "email": "ana@x.cl", "name": "Ana Pérez",
            "emailVerifiedAt": null },
  "tenant": { "id": "…", "slug": "…", "name": "…", "plan": "BASIC", "status": "ACTIVE" },
  "membership": { "role": "OWNER", "status": "ACTIVE" }
}
```

Errores: 400 validación, 409 `email_already_registered`.

# 2. `POST /v1/auth/login`

```jsonc
{ "email": "ana@x.cl", "password": "…" }
// 200 → mismo cuerpo de sesión que register (sin tenant si no hay membership activa? — en Fase 1 siempre hay al menos una)
```

Errores: 401 `invalid_credentials` (idéntico para email inexistente/password incorrecto); 403 `account_disabled`.

# 3. `POST /v1/auth/refresh`

```jsonc
{ "refreshToken": "<opaco>" }
// 200 → { accessToken, refreshToken, expiresIn }
// 401 invalid_refresh_token / reuse detected → 401 + revocación de familia
```

# 4. `POST /v1/auth/logout`

Protegido. Revoca la familia de la sesión actual.

```jsonc
// request
{ "refreshToken": "<opaco>" }
// 204
```

# 5. `POST /v1/auth/switch-tenant`

Protegido. Cambia el tenant activo de la sesión (multi-membership).

```jsonc
{ "tenantId": "…" }
// 200 → nueva sesión (access con tenant nuevo) + membership del nuevo tenant
// 403 si no hay membership activa en ese tenant, o 404 si no existe
```

# 6. `GET /v1/me`

Protegido. Principal del request.

```jsonc
// 200
{
  "user": { "id": "…", "email": "…", "name": "…", "emailVerifiedAt": "…" },
  "currentTenant": { "id": "…", "slug": "…", "name": "…", "plan": "BASIC", "status": "ACTIVE" },
  "membership": { "role": "OWNER", "status": "ACTIVE" },
  "memberships": [
    { "tenantId": "…", "tenantName": "…", "role": "OWNER", "status": "ACTIVE" }
  ]
}
```

# 7. Invitaciones

Requiere auth y rol.

## 7.1 `POST /v1/invitations` — crear invitación
Rol: `OWNER` / `ADMIN`. Tenant: el activo del context.

**Matriz de roles invitables** (regla en `roles.ts` → `canInviteRole`):
`OWNER` puede invitar a `OWNER`, `ADMIN` o `AGENT`; `ADMIN` solo a `ADMIN` o `AGENT` (un ADMIN no puede autoascenderse creando un `OWNER`). El formato del body acepta cualquier rol del CHECK; la negativa es 403 `forbidden`.

```jsonc
{ "email": "pedro@x.cl", "role": "AGENT" }
// 201
{ "id": "…", "email": "pedro@x.cl", "role": "AGENT", "status": "PENDING",
  "expiresAt": "…", "createdAt": "…" }
```

Reglas: no invitar a un email ya miembro del tenant; no duplicar PENDING para el mismo email; email normalizado. Errores: 400 validación, 403 rol insuficiente o `forbidden` (ADMIN→OWNER), 409 `already_member` / `invitation_pending`, 429 rate limited.

El **token** se envía al email (por `EmailSender`); no se devuelve en el API.

## 7.2 `POST /v1/invitations/accept`

Público (autenticado). Acepta con el token de la invitación. El usuario autenticado **debe coincidir** con `invitations.email`.

```jsonc
{ "token": "<opaco>" }
// 200 → { tenantId, tenantName, role, status, accessToken, refreshToken, sessionId, expiresIn }
// 400 invalid_token (inválido / vencido / usado / revocado / otro email: mismo código)
```

Efecto: la respuesta trae **tokens de sesión**, no solo metadatos. Aceptar cambia el tenant activo, y el cliente necesita un access token con el `tenant_id` del tenant nuevo sin hacer un `switch-tenant` extra.

otros efectos: consumo 1-uso (`accepted_at` + `accepted_by`), creación de la membership con el rol propuesto, y `email_verified_at` si el email aún no estaba verificado. `maxUsers` del plan se revalida **dentro** de la misma transacción, porque entre la invitación y la aceptación pueden haber entrado otras.

## 7.3 `DELETE /v1/invitations/:id` — revocar
Rol: `OWNER`/`ADMIN` del tenant de la invitación. `status→REVOKED`, `revoked_at`. Errores: 404 `invitation_not_found` (si no pertenece a tu tenant), 403 sin rol, 409 si `PENDING` ya no lo es.

# 8. Verificación de email

## 8.1 `POST /v1/email-verification/verify`
Público (autenticado). `{ "token": "<opaco>" }` → 200 `{ emailVerifiedAt }` o 400 `invalid_token`.

## 8.2 `POST /v1/email-verification/resend`
Protegido. Reenvía un token nuevo (invalida el anterior). Rate limited.

# 9. Recuperación de contraseña

## 9.1 `POST /v1/auth/forgot-password`
Público (rate limited 5/10 min). `{ "email" }` → 204.

Respuesta **uniforme**: el mismo 204 con email inexistente, cuenta deshabilitada o envío realizado, para que el endpoint no sea un oráculo de cuentas registradas. Con cuenta activa se emite un token opaco de reset de **1-uso (15 min)**, se invalidan los resets pendientes previos del usuario y se envía por email (template `reset-password`). El token solo viaja por email (y hasheado en BD); nunca en la respuesta.

## 9.2 `POST /v1/auth/reset-password`
Público (rate limited 10/10 min).

```jsonc
{ "token": "<opaco>", "newPassword": "••••••••••••" }
// 204
```

`newPassword` cumple la misma política que el registro (12-72 con mayúscula, minúscula, número y símbolo). Consumo (1-uso) y cambio de hash Argon2id van en la misma transacción; fuera de ella se **revocan todas las sesiones** del usuario y se invalidan los demás resets pendientes. Errores: 400 `validation_error`; 400 `invalid_token` (idéntico para token inválido, vencido o ya usado).

# 10. Usuarios del tenant

## 10.1 `GET /v1/tenants/:tenantId/users`
Rol: miembro activo del tenant (AGENT incluido; ADMIN/OWNER ven roles). El `:tenantId` debe coincidir con el tenant activo del context, sino 404/403 (no revelar existencia).

```jsonc
// 200
{ "items": [ { "id": "…", "email": "…", "name": "…", "role": "AGENT",
               "status": "ACTIVE", "emailVerifiedAt": "…" } ], "total": 1 }
```

## 10.2 `PATCH /v1/tenants/:tenantId/users/:userId` — cambiar rol/estado
Rol: `OWNER`/`ADMIN` (ADMIN puede gestionar no-OWNER). `{ "role"?, "status"? }`. Errores: 403, 404, 409 (no degradas al último OWNER sin otro OWNER).

# 11. Tenant

## 11.1 `GET /v1/tenants/current` — tenant activo
Protegido. Metadatos del tenant activo.

## 11.2 `PATCH /v1/tenants/current`
Rol: `OWNER`. Editar `name`, `slug`. No editar `plan`/`status` por tenant (billing/super-admin).

# 12. Formato de errores consolidado

| Código HTTP | Error (código) | Cuándo |
|---|---|---|
| 400 | `validation_error` | DTO inválido |
| 400 | `invalid_token` | token de invitación, verificación o reset inválido, vencido, ya usado, revocado o dirigido a otro email (un mismo código para todos los casos, para no servir de oráculo) |
| 401 | `invalid_credentials` / `invalid_refresh_token` / `token_expired` | auth |
| 401 | `reuse_detected` | refresh reusado (revoca familia) |
| 403 | `account_disabled` / `tenant_inactive` / `membership_inactive` | estados |
| 403 | `forbidden` | rol insuficiente |
| 404 | `not_found` / `invitation_not_found` / `user_not_found` | recursos |
| 409 | `email_already_registered` / `already_member` / `invitation_pending` / `email_in_use` | conflictos |
| 429 | `rate_limited` | límites de login/invitaciones/resend |

Los filtros globales garantizan: sin stack traces al cliente, con `requestId` para correlación.