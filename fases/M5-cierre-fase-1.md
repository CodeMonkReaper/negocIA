# M5 — Cierre de la Fase 1: invitaciones, verificación de email, tenants y usuarios

| Campo | Valor |
|---|---|
| Fase | 1 (identidad) |
| Fecha | 30/09/2026 |
| Estado | **Completo** — Fase 1 cerrada en código y verificación |
| Referencias normativas | `docs/api/authentication.md` §7–§11, `docs/architecture/authentication.md`, ADR-008, `docs/database/schema.md`, ADR-007 (límites de plan), `fases/M1`…`M4` |

## 1. Contexto y objetivo

Con la base de M-4 (auth + contexto de tenant + refresh rotación) operativa, la Fase 1 cerraba con tres piezas de onboarding: invitar miembros con rol y expiración, verificar el email con token de un solo uso, y exponer la gestión de tenants y usuarios (leer/editar metadatos del tenant, listar miembros, cambiar rol/estado). A esto se sumó la condición para poder llamarla cerrada: **CI en GitHub Actions** y un runbook `verify` que reproduce toda la verificación en un solo comando.

Este hito entregó, además, el cierre de una decisión formal de M-3: el módulo de tenants usa `LimitsService.assertUnderLimit` (ADR-007) para que ninguna invitación supere `maxUsers` del plan.

### Criterios de done

1. Módulo `invitations` M-5: crear/aceptar/revocar invitaciones (rol, expiración, límite de plan) y verificación de email (verify/resend).
2. Módulo `tenants`: leer/editar tenant activo y listar/editar usuarios del tenant.
3. Invariante "no quedar sin el último OWNER" cerrada ante carreras reales (no solo por tipado).
4. Suites unit/integración/e2e en verde, lint, typecheck, build y `db:check`.
5. `.github/workflows/ci.yml` + script raíz `verify` ampliado (build + db:check).

Fuera de alcance: plantilla real de email (sigue `MockEmailAdapter`), recuperación de contraseña, y la decisión de negocio "¿puede un ADMIN autoconcederse el rol OWNER?" (ver §6-7).

## 2. Endpoints entregados (contrato en `docs/api/authentication.md` §7–§10)

| Endpoint | Autenticación / rol | Comportamiento clave |
|---|---|---|
| `POST /v1/invitations` | bearer, `@Roles(OWNER, ADMIN)` | 201. Rol propuesto con `@IsIn(ROLES)` (incluye OWNER). Throttle 30/h. El token **no** vuelve en la respuesta: solo existe en el email y como hash en BD |
| `POST /v1/invitations/accept` | bearer (ver §3.2) | 200 + sesión emitida (`SessionService`). Cualquier fallo → `400 invalid_token` |
| `DELETE /v1/invitations/:id` | bearer, `@Roles(OWNER, ADMIN)` | 204. 404 si no existe o es de otro tenant; 409 si no está `PENDING` |
| `POST /v1/email-verification/verify` | bearer | 200. Consume el token 1-uso; marca `email_verified_at` |
| `POST /v1/email-verification/resend` | bearer | 200 `{sent}`. Invalida pendientes y emite uno nuevo. Throttle 5/15 min |
| `GET /v1/tenants/current` | bearer, sin `@Roles` | 200. Metadatos del tenant **del token**, nunca del path |
| `PATCH /v1/tenants/current` | `@Roles(OWNER)` | 200/409. Edita `name` y `slug`; `plan`/`status` no editables (400 `validation_error` por `forbidNonWhitelisted`) |
| `GET /v1/tenants/:tenantId/users` | bearer, sin `@Roles` | 200 `ListResponse` plana. `:tenantId` ≠ token → 404 |
| `PATCH /v1/tenants/:tenantId/users/:userId` | `@Roles(ADMIN)` jerárquico | 200/403/409. ADMIN no toca OWNER; nadie deja el tenant sin el último OWNER activo |

## 3. Diseño y decisiones

### 3.1 Invitaciones (`InvitationsService`)

Puertos inyectados: `UNIT_OF_WORK`, `INVITATION_REPOSITORY`, `MEMBERSHIP_REPOSITORY`, `USER_REPOSITORY`, `OPAQUE_TOKEN_GENERATOR`, `TOKEN_HASHER`, `EMAIL_SENDER`, `LimitsService`, `SessionService`.

- **`INVITATION_TTL_SECONDS = 48h`** (ADR-008). Expiración **perezosa**: en cada operación se compara `expires_at` con `now`; no hay job de limpieza.
- **Token solo hasheado**: se persiste `hashToken(crudo)` (SHA-256) y el crudo existe únicamente dentro de `EmailSender`. Por eso el DTO de respuesta no lleva token: no hay ninguno que devolver.
- **`create`**: normaliza email (`normalizeEmail`), `assertUnderLimit` (thread-safe por el partial unique `(tenant_id, email) WHERE status='PENDING'`), 409 si ya es miembro, si hay pendiente (`invitation_pending`) o si el email entra en conflicto. `isUniqueViolation` traduce el `P2002` de Prisma a error de dominio.
- **`accept`**: exige token válido con hash, `PENDING`, no vencido y **del email del principal autenticado**. El `LimitService` se revalida dentro de la misma transacción de aceptación (entre la invitación y el accept pudo entrar otro miembro). Emite sesión y la devuelve en el cuerpo (`IssuedSession`).
- **`revoke`**: por id de URL; si la invitación es de otro tenant → 404 idéntico al "no existe" (no confirmar existencia).

### 3.2 Verificación de email (`EmailVerificationService`)

- `verify` **no ata el token al principal** a propósito: el token es la prueba; atarlo a `request.userId` impediría verificar desde otro dispositivo (el caso móvil→portátil).
- Distingue internamente `verified` vs `expired` (`VerifyOutcome`), y en el caso vencido **commitea el consumo** antes de lanzar: el throw no debe deshacer el `markUsed`.
- `verify` es **system-scoped**: vive como `EmailVerificationController` aparte del de invitaciones, porque su eje de autorización (identidad propia) no es el de tenant.
- `invitations/accept` **sí** está autenticado, aunque sea la operación "de entrada": se necesita el `Principal` para comprobar que el token corresponde al email autenticado. Lo que sí se evita es un endpoint público que deje la comprobación en manos del cliente.

### 3.3 Tenants y usuarios

- **`TenantService`** (`getCurrent`/`updateCurrent`) usa `@Inject(TENANT_REPOSITORY)`: es el segundo caso (tras `SessionService` en M-4) donde una interfaz como último parámetro del constructor rompe la reflexión de Nest → token de DI explícito y **valor** (no `import type`) para la clase inyectable.
- **`updateCurrent`**: solo `name`/`slug`; el slug se conserva `slugify()`-normalizado por el lado del servicio como defensa (llamadas no-HTTP), pero el contrato exige que el cliente envíe ya normalizado (`UpdateTenantDto.slug` valida `^[a-z0-9]+(?:-[a-z0-9]+)*$`, min 3, max 60). Slug ocupado → `409 conflict`.
- **`TenantUsersService`**: `listUsers` (plano, `listByTenant`) y `updateUser`. Guard jerárquico: el actor con `hasAtLeast(actorRole, "ADMIN")` pasa el `@Roles`; el servicio relee el rol del **objetivo** desde BD y lanza `403 forbidden` si el objetivo es OWNER y el actor no. Los cambios se modelan como union discriminada `Change` (`kind: "role"`/`kind: "status"` con `value`), evitando el bug de comprobar `"role" in change` sobre una variante unaria.
- **`assertTenantInUrl`**: `:tenantId` distinto del token → `NotFoundError` (404), nunca 403, para no revelar la existencia de tenants ajenos.

### 3.4 Invariante del último OWNER (carrera real)

`MembershipRepository.lockActiveOwners(tenantId)` → `SELECT … FOR UPDATE` sobre las filas `role='OWNER' AND status='ACTIVE'` (impl Prisma con `$queryRaw` sobre `PgPool` cast a `Prisma.TransactionClient`, porque el tag template no se invoca sobre una unión de clientes). El servicio, cuando el cambio `becomesNonOwner`, hace lock → `countActiveOwners` → si `<= 1` → `409 conflict` con `details.owners`. Sin el lock, dos OWNER degradándose a la vez leen `count = 2` y dejan el tenant con 0 dueños; con él, el segundo espera al commit (READ COMMITTED) y su re-conteo ya ve 1. Los dobles en memoria lo implementan como no-op: no hay filas compartidas.

### 3.5 Paridad de errores (cierre de una deuda M-3)

`DOMAIN_ERROR_CODES` en `src/domain/errors/app-error.ts` ahora es un **array runtime** (`DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]`), y `app-error.spec.ts` compara `[...DOMAIN_ERROR_CODES]` contra `[...API_ERROR_CODES]` de `@negocia/contracts`. La paridad se prueba contra el catálogo real del paquete de contratos, no contra una transcripción manual (la del wire la sigue cubriendo `packages/contracts/src/identity-vocabulary.spec.ts`).

## 4. Inventario de archivos

### Módulo `invitations`
| Archivo | Contenido |
|---|---|
| `src/modules/invitations/invitations.module.ts` | Registro de controller + servicios |
| `src/modules/invitations/application/invitations.service.ts` | create/accept/revoke, `INVITATION_TTL_SECONDS`, `isUniqueViolation` |
| `src/modules/invitations/application/email-verification.service.ts` | verify (token 1-uso) / resend, `VerifyOutcome` |
| `src/modules/invitations/presentation/invitations.controller.ts` | `InvitationsController` + `EmailVerificationController` |
| `src/modules/invitations/presentation/invitation.mapper.ts` | `toInvitationDto`, `toAcceptInvitationDto` |
| `src/modules/invitations/presentation/dto/invitation-input.dto.ts` | `CreateInvitationDto` (`@IsIn(ROLES)`, trim), `AcceptInvitationDto`, `VerifyEmailTokenDto`, `InvitationIdParamDto` |
| `src/modules/invitations/application/*.spec.ts` | 19 + 8 tests unitarios |

### Módulo `tenants`
| Archivo | Contenido |
|---|---|
| `src/modules/tenants/tenants.module.ts` | Registro; importa `AuthModule` |
| `src/modules/tenants/application/tenant.service.ts` | `getCurrent`/`updateCurrent` (`@Inject(TENANT_REPOSITORY)`, `slugify`, 409 slug ocupado) |
| `src/modules/tenants/application/tenant-users.service.ts` | `listUsers`/`updateUser`, `Change` union, invariante OWNER |
| `src/modules/tenants/presentation/tenants.controller.ts` | 5 rutas; `assertTenantInUrl` → 404 |
| `src/modules/tenants/presentation/tenant.mapper.ts` | `toCurrentTenantDto`, `toTenantUserDto`, `toUpdateTenantUserDto` |
| `src/modules/tenants/presentation/dto/tenant-input.dto.ts` | `UpdateTenantDto` (slug regex), `UpdateTenantUserDto` (`@IsIn(ROLES)`, `@IsIn(MEMBERSHIP_STATUSES)`) |
| `src/modules/tenants/presentation/dto/tenant-param.dto.ts` | `TenantIdParamDto`, `TenantUserIdParamDto` (`IsUUID`) |
| `src/modules/tenants/application/*.spec.ts` | 12 + 8 tests unitarios |

### Dominio e infraestructura tocados
| Archivo | Cambio |
|---|---|
| `src/domain/errors/app-error.ts` + `app-error.spec.ts` | `DOMAIN_ERROR_CODES` runtime + test de paridad (2 tests) |
| `src/domain/ports/membership-repository.ts` | `listByTenant`, `countActiveByTenant`, `countActiveOwners`, `lockActiveOwners` |
| `src/infrastructure/database/repositories/prisma-membership.repository.ts` | `$queryRaw` FOR UPDATE sobre `PgPool` cast a `PgTransaction`/`Prisma.TransactionClient` |
| `src/infrastructure/database/database.module.ts` | binding de `TENANT_REPOSITORY` y EMAIL sender al registrar el módulo tenants |
| `src/domain/identity/statuses.ts` | fuente canónica de `MEMBERSHIP_STATUSES`/`MembershipStatus`/`isMembershipStatus` |
| `src/domain/identity/membership-status.ts` | **eliminado** en el cierre: duplicaba `statuses.ts` (ver §7) |

### Otros
| Archivo | Cambio |
|---|---|
| `packages/contracts/src/invitations.ts` | `InvitationDto`, `TenantUserDto`, `CurrentTenantDto`, `AcceptInvitationResponseDto`, `UpdateTenantResponseDto` (= `CurrentTenantDto`), `UpdateTenantUserResponseDto` |
| `apps/api/test/invitations.{integration,e2e}-spec.ts`, `tenants.{integration,e2e}-spec.ts` | suites nuevas (ver §5) |
| `.github/workflows/ci.yml` | workflow CI nuevo |
| `package.json` (raíz) | `verify` ampliado con `build` y `db:check` |

## 5. Verificación (evidencia, 30/09/2026)

`pnpm verify` completo, en verde (se ejecuta de extremo a extremo):

| Etapa | Resultado |
|---|---|
| Lint (turbo) | 9/9 tareas OK |
| Typecheck (turbo) | 9/9 OK (incluye `prisma generate` de `@negocia/database` y `tsc --noEmit`) |
| Build (turbo) | 5/5 OK (`nest build` + `next build` 16.3.6 + contracts/config) |
| Unit | `apps/api` 17 files / **169** tests + `contracts` 1 file / **11** tests |
| Integración | 4 files / **36** tests (`dependency-probe`, `auth`, `invitations`, `tenants`) |
| E2E | 4 files / **78** tests (`health`, `auth`, `invitations`, `tenants`) |
| `db:check` | `PostgreSQL connection OK` |

Detalles de suites nuevas: `invitations.integration.spec.ts` y `tenants.integration.spec.ts` (8 tests de tenants con el caso de carrera `Promise.allSettled`: al final queda exactamente 1 OWNER activo y los rechazos llevan `conflict`); `tenants.e2e-spec.ts` (17 tests: 401/403/404/409/400 por HTTP; el caso con 3 miembros sube el tenant a `plan=PRO` por DB antes de invitar, porque BASIC tiene `maxUsers=2`).

## 6. Incidencias y resoluciones

1. **DI en `TenantService`**: `Nest can't resolve dependencies (?)… argument at index [0] undefined` con variante `import type` en el constructor → resuelto con `@Inject(TENANT_REPOSITORY)` y la clase inyectable importada como **valor**. Misma lección que M-4 (`SessionService`).
2. **`"role" in change`**: el test de `updateUser` fallaba porque la variante unaria de la unión expone el campo como `value`, no como `role`. Se reemplazó por dispatcher sobre `change.kind`.
3. **Carrera del último OWNER**: inicialmente solo guiada por test de lógica; el test de integración la reproducía de forma intermitente hasta que `lockActiveOwners` (FOR UPDATE) cerró la lectura-comparación-escritura dentro de la misma transacción.
4. **Slug no normalizado**: el DTO rechaza `"Café de Ana"` con 400 y el e2e lo documenta; se mantiene `slugify()` en el servicio como defensa para llamadas no-HTTP.
5. **Plan BASIC en e2e**: el caso "ADMIN gestiona AGENT" necesita 3 miembros y `maxUsers(BASIC)=2` → el test actualiza `plan='PRO'` en BD antes de añadir el tercero.
6. **Paridad de errores**: la copia comentada empezaba a divergir; se eliminó la transcripción en `app-error.ts` y se cubrió con test runtime contra `API_ERROR_CODES`.
7. **Lint**: `ApiProperty` sin usar en `tenant-input.dto.ts` → se quitó de los imports.

## 7. Lecciones aprendidas

- La regla "el token es la prueba" (verify system-scoped) es la que permite el caso multi-dispositivo; comprobar el token contra el principal habría sido más "estricto" y peor.
- Los DTOs de entrada viven en `apps/api` (deps de `class-validator`/Swagger); los de respuesta en `@negocia/contracts`. Mover los primeros al paquete compartido obligaría al front a arrastrar la validación del servidor.
- Modelar el historial de cambios del usuario como union discriminada con un campo `value` unario quita los bugs de shape checking.
- La expiración perezosa + partial unique cubren la vista por email sin un job de limpieza; el límite real lo sigue poniendo el CHECK + la revalidación en `accept`.
- **Deuda de negocio a confirmar**: ~~si un ADMIN puede invitar a un OWNER de su mismo tenant (autoconcederse el control)~~ **RESUELTO (30/09):** matriz `canInviteRole` en `domain/identity/roles.ts` — OWNER invita a OWNER/ADMIN/AGENT; ADMIN solo a ADMIN/AGENT (403 `forbidden`). No aplica autoconcesión. Tests/docus actualizados (ver F1-C1 e §18.item3 de PROJECT_CONTEXT).
- **Consolidación**: `membership-status.ts` duplicaba `statuses.ts` (mismo contenido). Se eliminó en el cierre y `statuses.ts` queda como fuente única de los estados de membresía; lo mismo aplica al resto de valores de identidad.

## 8. Próximo paso

**Fase 2 — integraciones externas: WhatsApp y proveedores LLM** (informe §12.4). Los errores de dominio ya contemplan `external_provider_error`/`llm_error`; `ApiError` y el `StructuredLogger` están listos. Antes, o en paralelo: un proveedor de email real para sustituir `MockEmailAdapter` (decisión de plantilla, ADR-008), la confirmación del límite de rol del §6, y el onboarding web/dashboard sobre `@negocia/contracts`.