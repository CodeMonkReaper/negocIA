# M3 — Puertos de dominio y reglas puras

| Campo | Valor |
|---|---|
| Fase | 1 (identidad) |
| Fecha | 24/09/2026 |
| Estado | **Completo** |
| Alcance | Solo M-3 (aprobado por el usuario) |
| Referencias normativas | `docs/architecture/dependency-rules.md` (§2, §5), `docs/architecture/authentication.md` (§4 hashing, §5 refresh), `docs/adr/005` (JWT + refresh rotation), `docs/adr/007` (planes y límites), `docs/adr/008` (invitaciones/verificación — `EmailSender`) |

---

## 1. Contexto y objetivo

Los casos de uso de identidad (M-4/M-5) deben implementarse contra **puertos de dominio** y **reglas puras**, sin acoplar la lógica a las librerías de persistencia o SDN (Prisma, argon2, jwt). Este hito materializa esa capa: interfaces (ports), adaptadores mock/stand-in y las dos reglas de negocio puras que los casos de uso consumirán (límites de plan y clasificación de refresh).

Criterios de done:

1. Runner de tests **Vitest** operativo en `apps/api` (config + script + specs).
2. `domain/ports`: interfaces `PasswordHasher`, `EmailSender`, `TokenHasher` (sin deps externas).
3. `infrastructure/`: `MockPasswordHasher`, `MockEmailAdapter`, `Sha256TokenHasher` (stand-ins hasta M-4/M-5).
4. `domain/plans`: `PlanCatalog` + `LimitsService` alineados al enum real del schema.
5. `domain/session`: `classifyRefreshLookup` y `computeTokenExpiry` fieles a `authentication.md §5`.
6. Verde: `pnpm test` (api), `build` 5/5, `typecheck` 8/8, `lint` 8/8.

Exclusiones: `argon2` + `jose` (deps pesadas/build nativo → M-4), repositorios Prisma (M-4), `AuthService`/guards/endpoints (M-4/M-5), env JWT (M-4), rate limiting por-route (M-4).

---

## 2. Infra de tests: Vitest

| Elemento | Detalle |
|---|---|
| Versión | `vitest@^5.0.1` (dev-dep; publicada 2026-09-15, fuera de la ventana `minimumReleaseAge`) |
| Config | `apps/api/vitest.config.mts` (extensión `.mts` → ESM explícito; evita el warning de `configLoader: 'native'` que genera el `.ts` en un paquete CJS) |
| Entorno | `node` |
| Include | `src/**/*.spec.ts` |
| Script | `"test": "vitest run"` en `package.json` |
| Ubicación | specs co-locadas junto al código (convención Nest); `tsconfig.build.json` ya excluye `**/*spec.ts` del `dist`, y `tsc --noEmit` de typecheck sí las compila |
| Estilo | imports explícitos de `vitest` (`describe/it/expect`), sin globals ni config global |

## 3. Puertos de dominio (`src/domain/ports`, interfaces puras)

| Archivo | Contenido |
|---|---|
| `password-hasher.ts` | `PasswordHasher { hash, verify }` (auth.md §4) |
| `email-sender.ts` | `EmailMessage { to, template: "verification"\|"invitation", data, token?, expiresAt? }` + `EmailSender { send }` (ADR-008) |
| `token-hasher.ts` | `TokenHasher { hashToken(plain): string }` (auth.md §5: BD guarda solo hash) |
| `index.ts` | re-exports de tipos |

Cumplimiento de capas (`dependency-rules.md` §2): las interfaces no importan NestJS, Prisma ni librerías externas.

## 4. Adaptadores (`src/infrastructure`, stand-ins con nombre de futuro)

| Archivo | Clase | Rol |
|---|---|---|
| `password-hasher.mock.ts` | `MockPasswordHasher` | hash reversible `mock:<plain>`; ejercita el contrato hasta que `Argon2PasswordHasher` exista (M-4) |
| `email-sender.mock.ts` | `MockEmailAdapter` | buffer en memoria `sent: EmailMessage[]` para asserts; el proveedor real llega en Fase 2 (ADR-008) |
| `token-hasher.sha256.ts` | `Sha256TokenHasher` | SHA-256 hex vía `node:crypto`; es el adapter **definitivo** (no mock) por design de auth.md §5 |

## 5. Planes y límites (`src/domain/plans`) — ADR-007

| Archivo | Contenido |
|---|---|
| `plan-catalog.ts` | `PLANS = ["BASIC","PRO","PREMIUM"] as const` (enum real del schema, `migration.sql:166`), `Plan`, `PlanLimits { maxUsers, maxMessages, maxProducts }`, `DEFAULT_PLAN = "BASIC"`, `PLAN_CATALOG`, `isPlan()` y `resolvePlan()` |
| `limits-service.ts` | `LimitsService.getLimits(plan)` (plan desconocido/null → BASIC); `assertUnderLimit(current, limitKey, plan)` lanza `ConflictError("conflict")` con `details { limitKey, limit, current, plan }` si `current >= limit` |
| `index.ts` | re-exports |

Valores provisionales del catálogo (único punto de cambio normativo — ADR-007):

| Plan | maxUsers | maxMessages | maxProducts |
|---|---|---|---|
| BASIC | 2 | 500 | 10 |
| PRO | 10 | 10 000 | 100 |
| PREMIUM | 50 | 100 000 | 1 000 |

Semántica de `assertUnderLimit`: **inclusivo** hasta el límite (2 usuarios BASIC permiten `current=2`? No: lanza cuando `current >= 2`, i.e. permite 0 y 1; el 2º fair es el que necesita el OWNER). Interpretación validada por tests: `current` = miembros actuales; lanza cuando alcanza el tope (no se puede agregar uno más).

## 6. Dominio de sesión puro (`src/domain/session`)

`refresh-session.ts` — typo de entrada + dos funciones puras (auth.md §5, ADR-005):

```ts
interface RefreshLookupResult { status: "not_found" | "found"; revokedAt?; replacedAt?; expiresAt?; }
type RefreshIntent = { kind: "reuse_attack" } | { kind: "invalid" } | { kind: "rotate" };
```

Orden de decisión de `classifyRefreshLookup` (estricto, fiel al doc):

| Condición | Intento | Justificación |
|---|---|---|
| `status = "not_found"` | `invalid` | token crudo desconocido |
| `revokedAt` | `reuse_attack` | ya revocado/rotado → posible robo |
| `expiresAt <= now` | `invalid` | expiración limpia; familia intacta |
| `replacedAt` (sin revoked) | `reuse_attack` | estado inconsistente defensivo |
| resto | `rotate` | rotación legítima |

`computeTokenExpiry(now, ttlSeconds)` suma TTL en segundos (los TTLs por env entran en M-4).

## 7. Tests unitarios (Vitest, 23 tests / 5 files)

| Spec | Casos clave |
|---|---|
| `domain/plans/limits-service.spec.ts` | límites por plan; resolución de plan desconocido/null/undefined → BASIC; boundary inclusivo (0,1 OK / 2 tira en BASIC); límite evaluado contra el **plan resuelto** |
| `domain/session/refresh-session.spec.ts` | 5 branches + expires `<=` now (exacto en `now` = expirado); `computeTokenExpiry` (30 s y 30 días) |
| `infrastructure/token-hasher.sha256.spec.ts` | formato `/^[0-9a-f]{64}$/`, determinismo, sensibilidad a input, **vector conocido** (violación a mano corregida con SHA-256 real calculado) |
| `infrastructure/email-sender.mock.spec.ts` | registro de mensaje; aislamiento de estado entre instancias |
| `infrastructure/password-hasher.mock.spec.ts` | roundtrip hash/verify; rechazo de wrong/cross |

## 8. Archivos del hito

| Archivo | Cambio |
|---|---|
| `apps/api/package.json` | script `test` + dev-dep `vitest@^5.0.1` |
| `apps/api/vitest.config.mts` | nuevo (config Vitest ESM) |
| `apps/api/src/domain/ports/{password-hasher,email-sender,token-hasher,index}.ts` | nuevos (interfaces) |
| `apps/api/src/infrastructure/password-hasher.mock.ts` | nuevo |
| `apps/api/src/infrastructure/email-sender.mock.ts` | nuevo |
| `apps/api/src/infrastructure/token-hasher.sha256.ts` | nuevo (adapter definitivo) |
| `apps/api/src/domain/plans/{plan-catalog,limits-service,index}.ts` | nuevos |
| `apps/api/src/domain/session/{refresh-session,index}.ts` | nuevos |
| `apps/api/src/domain/plans/limits-service.spec.ts` | spec (5) |
| `apps/api/src/domain/session/refresh-session.spec.ts` | spec (9) |
| `apps/api/src/infrastructure/token-hasher.sha256.spec.ts` | spec (4) |
| `apps/api/src/infrastructure/email-sender.mock.spec.ts` | spec (2) |
| `apps/api/src/infrastructure/password-hasher.mock.spec.ts` | spec (3) |
| `fases/M1-modelo-identidad.md` | **fix**: enum de plan `STARTER|BASIC|GROW` → `BASIC|PRO|PREMIUM` (el CHECK real es `BASIC|PRO|PREMIUM`, `migration.sql:166`) |
| `fases/README.md` | índice + fila M3 |

## 9. Verificación (evidencia)

| Pipeline | Resultado |
|---|---|
| `pnpm --filter @negocia/api test` | **5 files / 23 tests passed** (340 ms) |
| `pnpm build` | **5/5** |
| `pnpm typecheck` | **8/8** |
| `pnpm lint` | **8/8** |

Incidencias resueltas durante la ejecución:

1. **Test `limits-service`: "usa el límite del plan resuelto"** — primera versión asumió que `ENTERPRISE` tenía límite alto; el plan resuelto es `BASIC` (maxUsers=2), por lo que `current=9` debe lanzar. Se corrigió la aserción (9→1 como caso OK), no el comportamiento.
2. **Vector SHA-256 fabricado a mano** en `token-hasher.sha256.spec.ts` — se sustituyó por el digest real calculado con `System.Security.Cryptography.SHA256` (`aa1c0a6e…0d09` para `t0k3n\x00raw`). Regla registrada: nunca inventar vectores criptográficos.
3. **Warning de Vite `configLoader: 'native'`** — `vitest.config.ts` (ESM syntax en paquete CJS) → renombrado a `vitest.config.mts` (ESM explícito). Eliminado el warning.
4. **Lint `no-unused-vars`** — import de `Plan` no usado en `limits-service.ts` tras quitar el cast redundante; se eliminó del import (el re-export al pie sigue exponiendo el tipo).

## 10. Decisiones registradas (minutas técnicas)

1. **Puertos en `domain/ports`, adaptadores en `infrastructure/` desde el inicio**: incluso los mocks viven en infraestructura para mantener la capa de dominio físicamente pura (`dependency-rules.md` §2).
2. **`Sha256TokenHasher` es el adapter definitivo** (no mock): el diseño auth.md §5 fija SHA-256 para tokens de 1-uso/refresh; no hay sustituto real posterior.
3. **Catálogo de planes provisional** (BASIC 2/500/10, PRO 10/10k/100, PREMIUM 50/100k/1k): único punto de cambio (ADR-007); los números se calibran cuando exista billing.
4. **Semántica `>=` en `assertUnderLimit`** con `current` = uso actual: el 1er uso que alcanza el tope se rechaza; se deja constancia porque es suelo de bugs.
5. **`.mts` para config de Vite/Vitest** en paquetes CJS (sin `"type": "module"`): silencia el native config loader sin tocar el module system del paquete.
6. **Tests co-locados + `tsconfig.build.json` excluye specs**: `dist` limpio y `typecheck` cubre los specs (capa de calidad extra).

## 11. Próximo paso

**M-4 — Auth + TenantContext**: instalar `argon2` (añadir a `allowBuilds`) + `jose`; repositorios Prisma (`User/Tenant/Membership/RefreshToken/Invitation/VerificationTokenRepository`) + `PrismaService`; `JwtAuthGuard` → `TenantContextGuard` → `RolesGuard`, `TenantContextService` (AsyncLocalStorage); `AuthService` (register tx, login anti-enumeración, refresh con rotación/reuse, logout, switch-tenant); endpoints `POST /v1/auth/*`; env JWT en `validateEnv`; rate limiting por-route en login/refresh. `LimitsService` y `classifyRefreshLookup` (M-3) se consumen aquí.