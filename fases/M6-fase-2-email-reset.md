# M6 — Fase 2: proveedor de email real (Resend) y recuperación de contraseña

| Campo | Valor |
|---|---|
| Fase | 2 (identidad / canal de email) |
| Fecha | 03/10/2026 |
| Estado | **Completo** en código y verificación de suites |
| Referencias normativas | ADR-009, `docs/api/authentication.md` §9, `docs/database/schema.md` §9, `docs/pendiente-fase-2.md`, ADR-008 (nota de tabla única), `fases/M5-cierre-fase-1.md` §8 |

## 1. Contexto y objetivo

Fase 1 quedó cerrada con el email entregado por `MockEmailAdapter` y sin recuperación de contraseña (pendientes de cierre, `docs/pendiente-fase-2.md`). Este hito los cierra y desbloquea Fase 2: sin un canal de email de producción no hay avisos reales (WhatsApp/LLM los usan), y la recuperación de contraseña es precondición del onboarding web (F3-1).

Decisiones de producto tomadas en sesión (recomendadas y aprobadas):

1. **Proveedor: Resend** vía SDK oficial (`resend`).
2. **Almacén del reset: tabla propia** `password_reset_tokens` (no reusar `verification_tokens`).
3. **Guard de producción:** `EMAIL_DRIVER=mock` con `NODE_ENV=production` → **error de arranque**.

### Criterios de done

1. `EmailModule` selecciona adaptador por `EMAIL_DRIVER`; `ResendEmailAdapter` renderiza text/HTML con escape y no propaga fallos del proveedor.
2. `validateEnv` valida las variables nuevas y bloquea `mock` en producción.
3. `POST /v1/auth/forgot-password` y `POST /v1/auth/reset-password` con respuestas 204 uniformes, `invalid_token` unificado, token 1-uso de 15 min, revocación de sesiones.
4. Suites unit / integración / e2e en verde + lint + typecheck.
5. Migración `password_reset_tokens` aplicada (`migrate:deploy`) y `db:check` OK.

Fuera de alcance: web consumer de la API (F3-1), WhatsApp/LLM (F2-3+), templates configurables por tenant, colas para envíos.

## 2. Decisión de diseño

### 2.1 Canal de email (`EmailModule` + `ResendEmailAdapter`)

- `EMAIL_DRIVER` (`mock | resend`, default `mock`) resuelto en `validateEnv`; `RESEND_API_KEY` obligatoria solo con `resend`.
- `ResendEmailAdapter` **no se instancia** con driver `mock` (su factory devuelve `undefined`): construir `new Resend(apiKey)` con key vacía lanza en dev/test.
- Render de plantillas en el adapter: `verification`, `invitation`, `reset-password` con asuntos y rutas de acción (`/verificar-email`, `/invitacion`, `/restablecer-password`) sobre `APP_BASE_URL`.
- **Anti-doble-escape:** las intros HTML reciben los datos crudos y escapan una sola vez (`perTemplateIntroHtml`), tras un bug inicial de `escapeHtml` aplicado dos veces (ver §6).
- **Best-effort:** un fallo del proveedor solo registra `warn`; el token ya quedó persistido antes de `send`.

### 2.2 Recuperación de contraseña (`PasswordResetSender` + `AuthService`)

- `password_reset_tokens` (id, user_id, token_hash, expires_at, used_at, created_at) con `UNIQUE(token_hash)` y FK CASCADE; TTL `RESET_TOKEN_TTL_SECONDS = 15 * 60`.
- **Emisión** (`forgotPassword`): homogénea — email inexistente/deshabilitado/suspendido → return silencioso; cuenta activa → `PasswordResetSender.send` que en una tx invalida los PENDING previos y crea el token (solo puede existir un reset vivo), y luego envía el email.
- **Consumo** (`resetPassword`): `assertPasswordPolicy` + Argon2 antes de la tx (no retener locks ~50 ms); hash del token con SHA-256; tx = `findByTokenHash` → `usedAt !== null` ⇒ `invalid_token`; vencido ⇒ `markUsed` + commit + lanzar `invalid_token` **fuera** de la tx (el token se consume igual, no puede "arreglarse" la fila); `markUsed` con la varianza devuelve `false` en carrera ⇒ `invalid_token`; si todo OK → `updatePassword` + `invalidatePendingByUser`.
- Después de la tx: `revokeAllForUser` (todas las familias del usuario quedan cerradas).
- Errores: un solo `InvalidTokenError` (400 `invalid_token`) para inválido/vencido/usado (no servir de oráculo).

## 3. Endpoints entregados (contrato `docs/api/authentication.md` §9)

| Endpoint | Auth | Comportamiento clave |
|---|---|---|
| `POST /v1/auth/forgot-password` | pública, Throttle 5/10 min | 204 uniforme (email inexistente/deshabilitado/envío). Token 1-uso 15 min solo por email + hash en BD |
| `POST /v1/auth/reset-password` | pública, Throttle 10/10 min | 204. Consume token, cambia password (Argon2), invalida pendientes, revoca todas las sesiones. 400 `invalid_token`/`validation_error` |

## 4. Inventario de archivos

### Config (`packages/config`)
| Archivo | Cambio |
|---|---|
| `src/api-environment.ts` | `EMAIL_DRIVERS`, `EmailDriver`, defaults `EMAIL_FROM`/`EMAIL_FROM_NAME`/`APP_BASE_URL`, validaciones (key condicional, guard prod+mock, regex `EMAIL_FROM`, http(s) sin path), helper `isHttpUrl` |
| `src/api-environment.spec.ts` | 9 casos nuevos (total 26) |

### Canal de email (`apps/api`)
| Archivo | Contenido |
|---|---|
| `src/infrastructure/email.module.ts` | Composition root: `MockEmailAdapter`, `ResendEmailAdapter` (factory solo con driver resend), selector `EMAIL_SENDER`, exports `[EMAIL_SENDER, MockEmailAdapter]` |
| `src/infrastructure/email-sender.resend.ts` | `ResendEmailAdapter`: `ResendClientLike`, `ResendEmailAdapterOptions`, render text/HTML (escape simple), `catch { }` con `warn` |
| `src/infrastructure/email-sender.resend.spec.ts` | 5 tests (payload verificación con fecha es-ES, escape HTML, template invitación, reset, fallo del proveedor) |
| `src/modules/auth/auth.module.ts` | Re-exporta `EmailModule` (quitado binding directo de `EMAIL_SENDER`) |

### Recuperación de contraseña
| Archivo | Contenido |
|---|---|
| `src/modules/auth/application/password-reset-sender.ts` | Emisión (`RESET_TOKEN_TTL_SECONDS`, invalidar pendientes en tx, email best-effort) |
| `src/modules/auth/application/auth.service.ts` | `forgotPassword` (uniforme) y `resetPassword` (hash antes de tx, commit-vencido-luego-throw, `revokeAllForUser`) |
| `src/modules/auth/presentation/auth.controller.ts` | `forgot-password`/`reset-password` (`@Public` + `@Throttle` + `204`) |
| `src/modules/auth/presentation/dto/auth-input.dto.ts` | `ForgotPasswordDto` (email trim+`@IsEmail`), `ResetPasswordDto` (token + `@MinLength(12)@MaxLength(72)`) |
| `src/domain/ports/password-reset-token-repository.ts` | `findByTokenHash`, `create`, `markUsed`, `invalidatePendingByUser` |
| `src/infrastructure/database/repositories/prisma-password-reset-token.repository.ts` | impl Prisma |
| `src/domain/ports/user-repository.ts` + `prisma-user.repository.ts` | `updatePassword` |
| `src/domain/identity/entities.ts` | `PasswordResetTokenRecord`, `CreatePasswordResetTokenInput` |
| `src/common/di-tokens.ts`, `src/domain/ports/unit-of-work.ts`, `src/infrastructure/database/unit-of-work.prisma.ts`, `database.module.ts` | token DI, `TransactionScope.passwordResetTokens`, wiring |
| `src/modules/auth/application/auth.service.spec.ts` | +9 tests (forgot/reset: emisión, invalidación, uniformidad, 1-uso, vencido, contraseñas débiles; el sender queda cubierto vía el servicio) |
| `src/testing/in-memory/fakes.ts` | `InMemoryPasswordResetTokenRepository` + scope/snapshot |

### Base de datos (`packages/database`)
| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | `model PasswordResetToken` + relación opuesta en `User` |
| `prisma/migrations/20261003000000_password_reset_tokens/migration.sql` | CREATE TABLE + índice |

### Docs
ADR-009; `docs/api/authentication.md` §9 + renumeración; `docs/database/schema.md` §9; `docs/pendiente-fase-2.md`; `PROJECT_CONTEXT.md` (capability rows, F2-1/F2-2, gap table, riesgo mock); `fases/README.md`; `.env.example`; `apps/api/test/auth.e2e-spec.ts` (6 tests reset).

## 5. Verificación (evidencia, 03/10/2026)

| Etapa | Resultado |
|---|---|
| `pnpm --filter @negocia/config run lint` / `typecheck` | OK |
| `pnpm --filter @negocia/config run test` | 1 file / **26** tests |
| `pnpm --filter @negocia/api run lint` | OK |
| `pnpm --filter @negocia/api run typecheck` | OK (tras `prisma generate` + build de `@negocia/database`) |
| `pnpm --filter @negocia/api run test` | 18 files / **186** tests |
| `pnpm --filter @negocia/api run test:integration` | 4 files / **36** tests |
| `pnpm --filter @negocia/api run test:e2e` | 4 files / **84** tests (6 nuevos de reset) |
| `pnpm --filter @negocia/database run db:check` | OK (migración aplicada el 03/10) |

## 6. Incidencias y resoluciones

1. **`PasswordResetToken` inexistente en typecheck tras generar**: `apps/api` tipa contra el cliente **compilado** (`dist`) de `@negocia/database`, no solo el generado → `pnpm --filter @negocia/database run build` (generate + tsc) resuelve (misma lección que `@negocia/config`).
2. **Doble escape en HTML**: `perTemplateIntroHtml` escapaba los datos que `render` ya había escapado (`safeTenant`/`safeRole`) → el test mostró `&amp;lt;script&amp;gt;`. Fix: las intros reciben datos crudos y escapan una sola vez.
3. **`AuthModule` exportaba `EMAIL_SENDER` que ya no provee**: Nest rechaza exportar providers ajenos. Fix: re-exportar `EmailModule` completo.
4. **`new Resend(undefined)` en dev/test**: el provider de `ResendEmailAdapter` se instanciaba siempre. Fix: factory condicional por driver (retorna `undefined` con mock).
5. **Assertions dependientes de zona horaria**: `toLocaleString("es-ES")` sobre `00:00Z` cae al día anterior en tz negativas → expiresAt de prueba a `12:00Z` (invariante bajo cualquier offset UTC±12).
6. **Reset test contaba todos los emails**: la verificación de `register` + olvidados confundía los conteos → filtrar por `template === "reset-password"`.
7. **`beforeEach` sin importar en vitest** (TS2304) en el primer borrado del spec del adapter.

## 7. Lecciones aprendidas

- El guard "la persistencia antes del envío" (patrón `EmailVerificationSender`) hace que el adaptador de email pueda ser best-effort sin romper la operación; los tests lo cubren con un proveedor que lanza.
- El driver de infraestructura se decide en el composition root; el resto del código ve un único puerto `EmailSender`. Importar `resend` queda confinado a `email.module.ts` + adapter.
- La desviación "DTOs de entrada locales" (policy de `@negocia/contracts`) volvió a aplicar: los cuerpos 204 ni siquiera necesitan tipos de respuesta en contracts.

## 8. Próximo paso

Fase 2 sigue con **F2-3 WhatsApp Cloud API** y **F2-4 conversaciones** (`PROJECT_CONTEXT.md`); antes el **web dashboard (F3-1)** ya puede consumir `forgot/reset-password` y login. `docs/pendiente-fase-2.md` queda con la web como único pendiente de cierre de Fase 1.