# 1. Objetivo

Especificar el diseño del sistema de autenticación y autorización autogestionado: sesiones, JWT mínimo, refresh rotation, password hashing y cómo se resuelve el principal por request.

# 2. Modelo general

```text
Token de acceso (access JWT)      → corto, identifica sesión + tenant activo
Token de refresco (refresh token) → largo, rotativo, almacenado como hash en BD
Sesión (session/jti)              → identificador de sesión dentro del JWT
Principal                         → usuario + memberships + roles, resuelto DESDE BD por request
```

- Autenticación: quién eres (`sub`, sesión válida).
- Autorización: qué puedes hacer dentro de un tenant (`membership.role` leído de BD).

# 3. JWT mínimo

Claims del access token:

```text
sub         → user_id
jti         → session_id (identificador de sesión/refresh family)
tenant_id   → tenant activo de la sesión (contexto; NO es autorización)
exp / iat   → expiración corta (15 min)
```

Prohibido:

- Claims de permisos, roles o límites: **el JWT no es fuente de verdad de autorización**.
- Datos de negocio innecesarios (precios, planes, configuración).
- PII innecesaria.

Razón: los roles/permisos cambian (revocación, cambio de rol, suspensión de tenant). Al resolver el principal por request, esos cambios son visibles inmediatamente sin esperar expiración del token.

# 4. Password hashing

- Algoritmo: **Argon2id** vía librería `argon2`.
- Encapsulado detrás del puerto de dominio `PasswordHasher`:

```ts
// dominio
interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
// infraestructura
class Argon2PasswordHasher implements PasswordHasher
```

- Parámetros Argon2id centralizados y configurables por entorno (memoria, tiempo/iteraciones, paralelismo) con valores recomendados seguros.
- `AuthService` y `UserService` dependen de `PasswordHasher`, no de `argon2`.
- **Nunca se registra un password ni su hash en logs, ni en errores, ni en payloads de jobs.**

# 5. Refresh token rotation + detección de reuse

Flujo normal (rotación):

```text
login/register/switch → 1 access JWT + 1 refresh token crudo (opaco)
refresh token crudo   → SHA-256 → token_hash → fila refresh_tokens
                        (expires_in, sin revocar)
...
POST /auth/refresh con refresh token:
   1. if sha256(token) no existe → 401
   2. if fila.revoked_at → detecté REUSE → revocar toda la familia (reuse attack)
   3. if expires_at < now → 401 (expiración limpia; familia sigue válida para otras sesiones)
   4. if fila ya tenía reemplazo (revoked por rotación normal) → reuse → revocar familia
   5. else:
        a. crear NUEVA fila refresh_tokens con nuevo token (nuevo hash, nueva expiración)
        b. marcar fila actual: revoked_at=now, replaced_by_token_id = nueva.id
        c. emitir nuevo access JWT (mismo jti? → nuevo jti de sesión) + nuevo refresh
```

Protección frente a ataques de reuse: si un token ya rotado/reemplazado vuelve a presentarse, **se revoca toda la familia** de refrescos de esa sesión (terminan las sesiones robadas).

# 6. Sesiones

- `jti` = id de sesión; representada por la familia de `refresh_tokens` (fila raíz + descendants via `replaced_by_token_id`).
- Logout: revoca la familia completa (o solo la sesión actual).
- Desconexión de seguridad: `POST /v1/auth/revoke-all` revoca todas las sesiones del usuario (usado en cambio de password).
- Fila de refresco guarda `ip` y `user_agent` (no obligatorio) para auditoría; nunca tokens ni hashes en logs.

# 7. Principal por request (sin caché de autorización)

En cada request autenticado:

1. `JwtAuthGuard` valida firma/expiración del access token → identidad (`sub`, `jti`, pista `tenant_id`).
2. `TenantContextGuard` resuelve el principal desde BD:
   - user existe y está `ACTIVE`;
   - membership (tenant_id, user_id) existe y está activa;
   - rol actual, estado del tenant (ACTIVE no SUSPENDED/CLOSED);
   - si algo no cuadra → 401/403 (no confiar en claims).
3. Se construye el `TenantContext` (ver `tenant-context.md`).

La caché corta de principal puede evaluarse en el futuro solo si métricas lo justifican (ADR-005).

# 8. Flujos: register, login, logout, switch-tenant

## Register
1. Validar `{ name, email, password }`.
2. Normalizar email (minúsculas/trim).
3. Verificar unicidad del email en BD.
4. `PasswordHasher.hash(password)`.
5. Crear `users` + `tenants` + `memberships(OWNER)` en una transacción.
6. Crear sesión (access + refresh).
7. Enviar email de verificación (`EmailSender` con token 1-uso).

## Login
1. Buscar user por email.
2. `PasswordHasher.verify`.
3. Validar `status`.
4. Emitir sesión.

## Logout
1. Verificar sesión.
2. Revocar familia de refresh de la sesión → el access token muere por expiración natural.

## Switch-tenant
1. Verificar membership objetivo (tenant_id, user_id) activa.
2. Emitir nueva sesión con `tenant_id` objetivo (o actualizar claim en nueva sesión). Se puede reusar el refresh o emitir nueva familia; diseño final: emitir nueva familia para la sesión nueva.

# 9. Autorización por rol

Roles: `OWNER > ADMIN > AGENT`. La autorización se evalúa contra el `role` del principal (BD), no contra el JWT.

| Acción (Fase 1) | OWNER | ADMIN | AGENT |
|---|---|---|---|
| Invitar usuario | ✅ | ✅ | ❌ |
| Revocar invitación | ✅ | ✅ | ❌ |
| Listar usuarios del tenant | ✅ | ✅ | ✅* |
| Cambiar rol de usuario | ✅ | ✅ | ❌ |
| Editar tenant (nombre/settings) | ✅ | ❌ | ❌ |
| Eliminar/cerrar tenant | ✅ | ❌ | ❌ |

\* AGENT ve solo lo necesario para su operación; se define con la matriz de funciones de cada fase.

# 10. Errores relevantes

| Caso | Error |
|---|---|
| Credenciales inválidas | 401 `invalid_credentials` |
| Cuenta deshabilitada | 403 `account_disabled` |
| Refresh inexistente/expirado | 401 `invalid_refresh_token` |
| Reuse detectado | 401 + revocación familia (login forzado) |
| Membership inactiva / tenant suspendido | 403 `tenant_inactive` / `membership_inactive` |
| Sin rol para la acción | 403 `forbidden` (403) |

No se debe distinguir al cliente entre "email no existe" vs "password incorrecta" en login (evitar enumeración).