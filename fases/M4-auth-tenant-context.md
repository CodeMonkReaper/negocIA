# M4 — Auth + TenantContext

| Campo | Valor |
|---|---|
| Fase | 1 (identidad) |
| Fecha | 29/09/2026 |
| Estado | **Completo** |
| Alcance | Solo M-4 (aprobado por el usuario) |
| Referencias normativas | `docs/architecture/authentication.md` (§4 hashing, §5 refresh, §6 claims, §7 guards), `docs/architecture/dependency-rules.md` (§2 capas, §5 DI), `docs/adr/005` (JWT + rotación de refresh), `docs/adr/007` (planes/límites), `PROJECT_CONTEXT.md` §22 |

---

## 1. Contexto y objetivo

M-3 dejó puertos de dominio y reglas puras, pero sin un solo camino que autentique a un usuario. M-4 cierra el circuito: registro, login, refresco con rotación, logout y cambio de tenant, con un **access token** que transporta identidad y un **refresh token** opaco que puede revocarse. Sobre esa base, el tenant activo deja de ser un parámetro de la request y pasa a ser contexto de ejecución construido contra PostgreSQL.

Criterios de done:

1. `argon2` (build nativo) + `jose` instalados y con `allowBuilds`.
2. Migración `refresh_tokens.session_id` / `tenant_id` aplicada (backfill incluido).
3. `PrismaService`, repositorios de `User/Tenant/Membership/RefreshToken`, `PrismaUnitOfWork` y traducción P2002/P2025.
4. Argon2id, emisión/verificación JWT HS256, generador opaco criptográfico y hashing SHA-256 de tokens.
5. `AuthService` + `SessionService` con rotación atómica, detección de reuse y revocación de familia.
6. Cadena de guards globales en el orden normativo + `AsyncLocalStorage` de tenant.
7. Endpoints `POST /api/v1/auth/*` y `GET /api/v1/me` con rate limiting por ruta.
8. Suites unitarias, de integración (PostgreSQL real) y e2e (HTTP real) verdes, y pipeline completo verde.

Exclusiones: verificación de email e invitaciones (`VerificationTokenRepository` queda implementado, sin endpoints), recuperación de contraseña, logout de todas las sesiones por configuración, SSO/OAuth, y el proveedor real de email (`MockEmailAdapter` sigue siendo el binding).

---

## 2. Migración — `20260929210324_refresh_token_session_id`

El modelo de M-1 modelaba la familia de refrescos como una cadena `replaced_by_token_id` sin columna que la identificara. Eso obligaba a recorrer la cadena hacia atrás (O(n) queries) para revocar una familia, y dejaba al backend sin forma de reconstruir el `tenant_id` de un access token renewal cuando el anterior ya había caducado (el cliente solo tiene el refresh opaco).

| Cambio | Detalle |
|---|---|
| `refresh_tokens.session_id` | `UUID NOT NULL` + índice; en la fila raíz cumple `session_id === id` |
| `refresh_tokens.tenant_id` | `UUID NOT NULL` + índice; tenant activo de la sesión, propagado a sucesores |
| Índice parcial | `refresh_tokens_session_id_active_idx … WHERE "revoked_at" IS NULL` sostiene el UPDATE de revocación de familia |
| Backfill `session_id` | Ancla cada fila a su raíz. Si un usuario tuviera **más de una** raíz, se ancla a sí misma en vez de elegir una arbitraria: fusionar sesiones de dispositivos distintos bajo un mismo `session_id` haría que un logout en el móvil matara la sesión del escritorio |
| Backfill `tenant_id` | Hereda el tenant de la raíz; con varias raíces usa la membresía activa más antigua, mismo criterio que `resolveInitialMembership` al hacer login |
| Foreign keys | **Sin FK a propósito.** Una auto-referencia `ON DELETE RESTRICT` impediría borrar la raíz con descendientes vivos, y el tenant de una sesión no se borra: se cierra con `status = CLOSED` |

La invariante `session_id === id` en la raíz es lo que hace que `jti` del access JWT sea directamente el `session_id`: "el `jti` es el identificador de la sesión" pasa a ser una igualdad literal, no una convención.

## 3. Puertos y adaptadores

### Puertos nuevos (`src/domain/ports`)

| Puerto | Contrato | Implementación |
|---|---|---|
| `AccessTokenIssuer` | `issue` / `verify` | `JwtAccessTokenIssuer` (jose, HS256) |
| `IdGenerator` | `next()` | `UuidIdGenerator` (`node:crypto` `randomUUID`) |
| `RefreshTokenRepository` | rotación, revocación, familia | `PrismaRefreshTokenRepository` |
| `UnitOfWork` | `run(fn)` transaccional | `PrismaUnitOfWork` |
| `UserRepository` / `TenantRepository` / `MembershipRepository` | lectura para login y contexto | `Prisma*.Repository` |

`IdGenerator` existe por una razón concreta: sin él, `AuthService` tenía que importar `node:crypto` (o el adapter) para generar ids, y la capa de aplicación dejaba de ser testeable sin infrastructure. Los ids en los tests pasan a ser una secuencia determinista y las aserciones dejan de depender de UUIDs aleatorios.

### Adaptadores de seguridad

| Archivo | Detalle |
|---|---|
| `argon2-password-hasher.ts` | `argon2id` con `memoryCost` 19 456 KiB (19 MiB), `timeCost` 2, `parallelism` 1 — los mínimos de OWASP. `verify` devuelve `false` ante hash corrupto en lugar de propagar la excepción: un `catch` que re-lanza convierte un dato dañado en un 500 |
| `jwt-access-token-issuer.ts` | Algoritmo **constante en código** (`HS256`), nunca leído del entorno. Si `JWT_ALGORITHM` fuera configurable, un despliegue mal configurado podría firmar con `none` o degradar a un algoritmo asimétrico. `typ: "JWT"` explícito para evitar el paso por `none` |
| `opaque-token-generator.ts` | `CryptoOpaqueTokenGenerator` (32 bytes → base64url) + `UuidIdGenerator` |

### Claims del access token

`sub`, `jti`, `tenant_id`, `iss`, `aud`, `iat`, `exp`. Deliberadamente **ausentes**: rol, email, permisos y plan. El rol cambia en BD sin que expire el token, y un claim de rol haría que una revocación de privilegios tardara hasta 15 minutos en surtir efecto. `docs/architecture/authentication.md` §6 manda: el JWT es un **portador de identidad**, y la autoridad se relee siempre.

---

## 4. Rotación de refresh: la parte que más fácil se hace mal

`SessionService.rotate()` es atómica y su orden es la decisión de diseño central de M-4:

```
dentro de una transacción:
  1. buscar el token por hash
  2. si revocado  → reuse_attack  (y revocar la familia completa)
  3. si expirado  → invalid
  4. crear el sucesor con el MISMO session_id y el MISMO tenant_id
  5. revocar el predecesor condicionalmente (WHERE revoked_at IS NULL)
  6. si el paso 5 no affected-row → alguien rotó en paralelo → reuse_attack
  7. commit; si algo falla → rollback, incluido el sucesor
```

Consecuencias que los tests fijan:

- **El sucesor hereda `tenant_id`.** Si no, un refresh de una sesión cuyo access ya caducó emitiría un token sin tenant — o con el del usuario, que puede ser otro.
- **`jti` = `session_id` = familia.** Un logout revoca una familia con un `UPDATE`, no recorriendo la cadena.
- **Reutilizar un token ya rotado revoca la familia entera.** Ante un robo, la única respuesta segura es cerrar todas las sesiones de esa familia, no solo la detectada: el atacante ya tiene un token válido de la cadena.
- **El rollback incluye al sucesor.** Crear el sucesor fuera de la transacción dejaría tokens vivos huérfanos si el `UPDATE` condicional fallara.
- **Todo refresh revocado se clasifica `reuse_detected`.** No existe un código `refresh_token_revoked`: distinguir "revocado por logout" de "revocado por rotación" en la respuesta es filtrar información sobre el estado de la sesión.

`AuthService` hereda esta clasificación de `classifyRefreshLookup` (M-3) sin duplicar la lógica.

---

## 5. Cadena de guards y contexto de tenant

Orden en `AppModule`, y por qué no es intercambiable:

| # | Guard | Razón de su posición |
|---|---|---|
| 1 | `ThrottlerGuard` | Limita **antes** de tocar BD, para que un abuso no consuma Argon2id ni PostgreSQL |
| 2 | `JwtAuthGuard` | Verifica la firma. Único guard que decide si hay token; `@Public()` es la excepción fail-closed |
| 3 | `TenantContextGuard` | Relee usuario/membresía/tenant de BD. Va **después** de verificar la firma porque consulta BD con un `sub` que todavía no es de fiar, y **antes** del guard de roles porque es quien carga el rol |
| 4 | `RolesGuard` | Autoriza cuando el rol ya viene de BD |

`TenantContextGuard` adjunta `request.tenantContext`; `TenantContextInterceptor` abre el `AsyncLocalStorage` **alrededor del handler**. El orden importa porque Nest ejecuta los `APP_INTERCEPTOR` después de todos los `APP_GUARD`: si el contexto se abriera en un guard, el `AsyncLocalStorage` quedaría cerrado antes de que empiece el controlador, y los casos de uso verían `undefined` en producción —con tests unitarios en verde, porque allí se inyecta el contexto a mano.

### Roles: `request.principal`, no el ALS

`RolesGuard` lee `request.principal` en lugar de `TenantContextService`. Son el mismo dato, pero `RolesGuard` es un guard de la **capa HTTP** y el ALS es un detalle de la capa de aplicación; leer el `request` hace que el guard sea testeable sin contexto asíncrono y evita que un fallo de propagación del ALS degrade a "sin rol" en vez de a un error visible.

---

## 6. Superficie HTTP

| Método | Ruta | Auth | Rate limit | Éxito |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | público | 5 / 10 min | 201 |
| POST | `/api/v1/auth/login` | público | 10 / 5 min | 200 |
| POST | `/api/v1/auth/refresh` | público | 60 / 5 min | 200 |
| POST | `/api/v1/auth/logout` | bearer | 100 / 60 s | 204 |
| POST | `/api/v1/auth/revoke-all` | bearer | 10 / 5 min | 204 |
| POST | `/api/v1/auth/switch-tenant` | bearer | 30 / 5 min | 200 |
| GET | `/api/v1/me` | bearer | 100 / 60 s | 200 |
| GET | `/api/health` | público, `@SkipThrottle` | — | 200 |

Decisiones de contrato:

- **Login no revela qué falló.** Email inexistente y contraseña incorrecta devuelven el mismo 401 `invalid_credentials` con el mismo mensaje. Un código distinto por caso convierte el endpoint en un oráculo de enumeración de cuentas.
- **Los DTO no aceptan campos desconocidos** (`whitelist` + `forbidNonWhitelisted`). Aceptar `role` en el alta sería una escalada de privilegios directa; la e2e lo cubre con un 400 explícito.
- **`switch-tenant` exige UUID** en el borde, no solo en el dominio: un `tenantId` malformado es un 400 de contrato, no un 403 de autorización.
- **Las respuestas nunca incluyen `passwordHash`, `tokenHash` ni el token opaco** (PROJECT_CONTEXT §22). La e2e comprueba la ausencia de `argon2` y de la contraseña en el cuerpo de la respuesta.

### Versionado URI

`AuthController` y `MeController` declaran `version: "1"`, pero eso **no produce** `/api/v1/...` por sí solo: sin `app.enableVersioning({ type: URI, defaultVersion: "1" })` en `main.ts` el segment se ignora silenciosamente y las rutas quedan en `/api/auth/...`. El versionado se habilitó en `main.ts` y se replicó en el helper de e2e, con un comentario cruzado en ambos: si divergen, la e2e valida una URL que el cliente real nunca recibe.

Como efecto colateral, `defaultVersion: "1"` desplazaba también `GET /api/health` a `/api/v1/health` — ruta ya publicada en `apps/web/.env` (`NEXT_PUBLIC_API_URL=…/api` + `/health`), en el README y en la documentación de despliegue. `HealthController.check()` lleva `@Version(VERSION_NEUTRAL)` para conservarla. (`@Version` es un decorator de **handler**: aplicado a la clase, Nest lanza `TypeError: Cannot read properties of undefined (reading 'value')` en tiempo de carga.)

---

## 7. Variables de entorno

`packages/config/src/api-environment.ts` valida `JWT_SECRET` con el mismo `MIN_JWT_SECRET_BYTES = 32` que aplica `JwtAccessTokenIssuer`, y ahora la exige en **todos** los entornos, no solo en producción.

El cambio cierra un fallo de arranque silencioso: antes, un `dev` o `test` con secreto vacío pasaba `validateEnv` y reventaba en el primer login con un error de firma de HS256, mucho menos descriptivo que un mensaje de variables de entorno. Validar en el mismo sitio donde se consume convierte un fallo diferido y opaco en un error temprano y accionable. No rompe los tests unitarios (no arrancan Nest) ni las suites de integración/e2e (inyectan su propio secreto de test).

Restricciones heredadas de M-4 que se validan juntas: `JWT_REFRESH_TTL_SECONDS > JWT_ACCESS_TTL_SECONDS` (un access válido no puede volverse irrecuperable), `ARGON2_MEMORY_COST ≥ 8192` y `parallelism ≤ memoryCost`.

---

## 8. Estrategia de tests

| Suite | Config | Objeto | Resultado |
|---|---|---|---|
| Unitaria | `vitest.config.mts` | lógica pura, adaptadores de seguridad, guards | **10 files / 102 tests** |
| Integración | `vitest.integration.config.mts` | DI real + PostgreSQL real + Argon2id real | **1 file / 17 tests** |
| E2E | `vitest.e2e.config.mts` | HTTP real vía Supertest sobre la app completa | **1 file / 27 tests** |

### Base de datos de test

`test/global-setup.ts` hace `DROP SCHEMA negocia_test CASCADE` + `prisma migrate deploy` una vez por ejecución; `test/helpers/database.ts` mantiene un `PrismaClient` cacheado y trunca entre tests. Las tres suites corren **en serie** (`fileParallelism: false`): comparten un único schema, y en paralelo los `TRUNCATE` de un test borrarían las filas del otro.

Nunca `prisma migrate reset` sobre la base de tests: Prisma lo bloquea para agentes, y `DROP SCHEMA` + `migrate deploy` produce el mismo estado sin depender de ese comando.

### Fakes in-memory

`src/testing/in-memory/fakes.ts` implementa los puertos completos (antes solo interfaces parciales, por lo que `tsc` linkaba los repositorios in-memory contra tipos distintos de los puertos reales). `InMemoryUnitOfWork` toma una instantánea y **restaura las mismas referencias de arrays**: si `run()` devolviera clones, un rollback parecería tener éxito sin haber deshecho nada, que es la clase de bug que los tests de unit of work existen para cazar.

### Qué cubre la e2e que la integración no puede

- Cadena de guards real y su orden.
- `ValidationPipe`, whitelist y `forbidNonWhitelisted`.
- Contrato de error (envelope de `@negocia/contracts` + `requestId`).
- Rutas públicas: `/api/health` y las de auth no exigen `Authorization`.
- 429 con el cuerpo de error correcto.
- **Autorización revisada contra BD en el request siguiente:** suspender el tenant → 403 con el token aún dentro de su ventana de validez; degradar el rol de `OWNER` a `AGENT` surte efecto sin esperar al vencimiento. Es la comprobación de que el JWT no es la fuente de autoridad, y es imposible de simular con un token fabricado.

### Ajustes necesarios para que la e2e fuera fiable

| Problema | Resolución |
|---|---|
| 27 tests en 429 | Una sola instancia de Nest para toda la suite: sus contadores de throttler sobreviven entre casos y el límite de 5 registros agotaba la cuota del resto. `resetThrottler()` los vacía en `beforeEach` (la prueba que **sí** quiere el 429 cuenta sus propios requests) |
| `Nest could not find ThrottlerStorageService` | El storage por defecto se registra bajo el token símbolo `ThrottlerStorage`, no bajo su clase. Se resuelve con `getStorageToken()` |
| `API_PORT inválido: "0"` | `validateEnv` rechaza el 0 (significa "puerto efímero"), y la e2e no abre ningún puerto: se pasa un puerto válido que nunca se escucha |
| 404 en `/api/health` | Efecto del `enableVersioning`; resuelto con `@Version(VERSION_NEUTRAL)` (§6) |
| 400 en email con espacios | `normalizeEmail` hace `trim().toLowerCase()` en el dominio, pero `@IsEmail()` del DTO rechazaba `" Ana@Example.com "` antes de llegar allí. Se añadió `@Transform` de `trim` en `RegisterDto` y `LoginDto`: el borde no puede rechazar una entrada que el dominio acepta, o el mismo email daría 201 en register y 400 en login |

---

## 9. Archivos del hito

### Creados — aplicación

| Archivo | Rol |
|---|---|
| `src/modules/auth/application/{auth,session,auth-config}.service.ts` | casos de uso, rotación de refresh, config tipada |
| `src/modules/auth/presentation/{auth.controller,auth.mapper}.ts` | superficie HTTP versionada y mapeo a DTO |
| `src/modules/auth/presentation/dto/{auth-input,auth}.dto.ts` | contrato de entrada (validado) y de salida (sin secretos) |
| `src/modules/auth/auth.module.ts` | composition root con `useExisting` |
| `src/common/guards/{jwt-auth,tenant-context,roles}.guard.ts` | cadena global |
| `src/common/guards/{public,roles}.decorator.ts` | metadatos de excepción y de rol requerido |
| `src/common/tenant-context/{tenant-context.service,tenant-context.interceptor,tenant-context.module}.ts` | ALS y su apertura |
| `src/infrastructure/security/{argon2-password-hasher,jwt-access-token-issuer,opaque-token-generator}.ts` | adaptadores de seguridad |
| `src/infrastructure/database/{prisma.service,unit-of-work.prisma,database.module}.ts` | Prisma y transacción |
| `src/infrastructure/database/repositories/prisma-*.repository.ts` | 5 repositorios + `translate-prisma-error.ts` |
| `src/domain/ports/{access-token-issuer,id-generator,refresh-token-repository,unit-of-work,…}.ts` | puertos |
| `src/testing/in-memory/fakes.ts` | dobles de test con rollback real |

### Tests

`apps/api/test/{global-setup.ts,auth.integration.spec.ts,auth.e2e-spec.ts}`, `apps/api/test/helpers/{env,database,app}.ts`, `apps/api/vitest.{integration,e2e}.config.mts`, y las specs unitarias de Argon2, JWT issuer, guards y ALS.

### Modificados

| Archivo | Cambio |
|---|---|
| `packages/database/prisma/migrations/20260929210324_refresh_token_session_id/` | nueva migración (backfill incluido) |
| `src/app.module.ts` | guards, filtro e interceptor globales |
| `src/main.ts` | URI versioning + `enableVersioning` |
| `src/modules/health/health.controller.ts` | `@Version(VERSION_NEUTRAL)` |
| `packages/config/src/api-environment.ts` | `JWT_SECRET` obligatoria en todos los entornos |
| `package.json` (raíz) | `test`, `test:integration`, `test:e2e`, `verify` |
| `turbo.json` | task `test` |
| `apps/api/package.json` | `test:integration`, `test:e2e`; deps `argon2`, `jose`, `supertest` |

---

## 10. Verificación

| Pipeline | Resultado |
|---|---|
| `pnpm lint` | **9/9** |
| `pnpm typecheck` | **9/9** |
| `pnpm build` | **5/5** |
| `pnpm test` | **10 files / 102 tests** |
| `pnpm test:integration` | **1 file / 17 tests** |
| `pnpm test:e2e` | **1 file / 27 tests** |
| `pnpm db:check` | OK |

`pnpm verify` encadena los cinco en ese orden.

### Incidencias resueltas

1. **`AuthConfigService` no se inyectaba en runtime.** Importado con `import type`, Nest recibe `undefined` como metadata de parámetro y el contexto de DI falla con un error opaco. Debe ser import de valor: es una clase, no solo una forma.
2. **`RolesGuard` autorizaba contra el servicio equivocado.** Leía el rol del ALS en lugar de `request.principal`; con el ALS sin poblar, `requiredRoles` se comparaba contra `undefined` y la comparación fallaba. Corregido y cubierto por test de regresión.
3. **`ThrottlerGuard` sin servicio de contexto** (M-2) dejaba el limitador inactivo, exactamente el bug que M-2 había dejado anotado. Resuelto al construir la cadena de guards reales.
4. **Hash Argon2 corrupto** provocaba excepción en `verify` en lugar de `false`.
5. **Fakes con interfaces parciales**: `tsc` linkaba los repositorios in-memory contra tipos distintos de los puertos reales, y el fallo no aparecía hasta añadir un método al puerto.
6. **Contaminación entre tests de e2e por el throttler** (§8).

---

## 11. Decisiones registradas

1. **`ID_GENERATOR` como puerto**, no `crypto.randomUUID()` en la aplicación: mantiene la capa de casos de uso testeable sin infrastructure y con ids deterministas.
2. **El `tenant_id` viaja en el refresh, no solo en el access.** Sin `tenant_id` en la familia, renovar una sesión caducada no podría reconstruir el contexto del tenant.
3. **`reuse_detected` no distingue por qué se revocó.** El atacante que reutiliza un token no necesita saber si su preoperative logout o rotación; y el cliente tampoco gana nada con esa información.
4. **Login no enumera cuentas.** Mismo código y mensaje para email inexistente y contraseña incorrecta.
5. **`HS256` fijo en código**, no configurable. La configuración de algoritmo es una superficie de ataque, no de flexibility.
6. **Los guards de rol leen `request.principal`**, no el ALS: la capa HTTP no depende de la propagación asíncrona.
7. **Rate limits por ruta** además del límite global de 100/60 s: el global protege la capacidad, el de ruta protege la credencial.
8. **Tests contra la base real, no contra SQLite ni dobles de repositorio.** Un `P2002` o un `CHECK` de rol solo se detecta contra el Postgres que ejecuta producción; las suites de integración y e2e son las que encuentran esos casos.
9. **`/api/health` se queda sin versión.** Es una URL ya publicada en el `.env` del front y en la documentación de despliegue; versionarla rompía el panel de estado sin que nadie tocase el front.

## 12. Próximo paso

**M-5 — Invitaciones y verificación de email** → **ejecutado**, ver `M5-cierre-fase-1.md` (cierre de la Fase 1): invitaciones con rol y expiración perezosa, límite de plan revalidado al aceptar (`LimitsService.assertUnderLimit`, ADR-007), verificación de email y API de tenants/usuarios. Permanece fuera de alcance (deferido): el proveedor real de email (sigue `MockEmailAdapter`) y el flujo de recuperación de contraseña, ambos para Fase 2.

Pendientes conocidos, ninguno bloqueante:

- `pnpm test` a nivel raíz cubre `@negocia/api` y `contracts` (primer spec en M-5: `identity-vocabulary.spec.ts`); `database` y `config` no tienen specs. `validateEnv` es candidato obvio a su primer spec propio.
- `API_PORT` inválido con valor `0` sigue siendo un error de validación; el e2e lo esquivó con un puerto válido, pero el mensaje podría distinguir "puerto efímero" de "puerto malformado".
