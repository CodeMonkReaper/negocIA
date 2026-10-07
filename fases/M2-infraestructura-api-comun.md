# M2 — Infraestructura de API común

| Campo | Valor |
|---|---|
| Fase | 1 (identidad) |
| Fecha | 24/09/2026 |
| Estado | **Completo** |
| Alcance | Solo M-2 (aprobado por el usuario) |
| Referencias normativas | `docs/architecture/dependency-rules.md`, `docs/api/authentication.md §11`, `docs/database/schema.md` |

---

## 1. Contexto y objetivo

Antes de implementar cualquier módulo de dominio (auth, tenants, invitaciones), la API necesita una infraestructura transversal consistente:

1. **Validación declarativa** de entrada (`class-validator` + `ValidationPipe` global).
2. **Modelo de errores clasificado** en la capa de dominio y un **único punto de mapeo** a respuestas HTTP con envelope canónico (`ApiError`), sin fugas de stack traces.
3. **Traza end-to-end**: el `requestId` de correlación presente en el body de error.
4. **Documentación OpenAPI** auto-generada (Swagger UI + spec) con security scheme `bearer`.
5. **Rate limiting** base global para rutas sensibles posteriormente (login, invitaciones, resend).

Criterios de done:

- `packages/contracts`: catálogo canónico de códigos de error + `ApiError.requestId` + `ListResponse<T>`.
- `apps/api`: `domain/errors` clasificado; `AllExceptionsFilter` global (`APP_FILTER`);
  `ValidationPipe` global en bootstrap; Swagger en `/api/docs` + `/api/docs-json` (bearer);
  `ThrottlerModule` global con `@SkipThrottle()` en health.
- `build` 5/5, `typecheck` 8/8, `lint` 8/8.
- Smoke tests: `/api/health` 200 (requestId), 404 con envelope `ApiError` + header `x-request-id`, `/api/docs` 200 UI, `/api/docs-json` 200 spec.

Exclusiones explícitas: health con DB/Redis (diferido a M-4 para no alterar el contrato `HealthResponse`), auth/guards/endpoints (M-4/M-5), DTOs de sesión/tenant/usuario (se crean con los endpoints), web y tests (M-6/M-7), JSON Schema para los DTOs.

---

## 2. Deconstrucción del contrato: `ApiError` canónico

`packages/contracts/src/index.ts` fue reescrito. Decisión de diseño: **los códigos de error son un catálogo cerrado** (`as const` array + union derivada) en lugar de una union literal inline, para:

1. Poder iterar/validar en runtime (candidato futuro a validación por lista permitida).
2. Darle a Swagger auto-described schema con el enum de códigos.
3. Mantener un solo lugar normativo de ampliación (agregar código = modificar `API_ERROR_CODES` + `DomainErrorCode` + doc §11).

| Elemento | Definición |
|---|---|
| `API_ERROR_CODES` | `Array<ApiErrorCode>` (22 códigos, `as const`) |
| `ApiErrorCode` | `(typeof API_ERROR_CODES)[number]` |
| `ApiError` | `{ code, message, details?, requestId? }` |
| `ApiEnvelope<T>` | `{ data: T }` (respuestas 2xx tipadas) |
| `ListResponse<T>` | `{ items: T[]; total: number }` (paginación estándar) |
| `HealthResponse` | sin cambios estructurales (ahora con `requestId?`) |
| `API_PREFIX` | `"/api"` (sin cambios) |

**Catálogo de códigos (22):**

| Código | HTTP | Uso esperado |
|---|---|---|
| `validation_error` | 400 | DTO inválido (incl. errores de pipe) |
| `invalid_credentials` | 401 | login con credenciales erróneas |
| `invalid_refresh_token` | 401 | refresh con token mal formado/no conocido |
| `token_expired` | 401 | refresh token expirado |
| `reuse_detected` | 401 | reutilización de refresh token (rotación rota) |
| `account_disabled` | 403 | usuario `DISABLED` |
| `tenant_inactive` | 403 | tenant `SUSPENDED`/`DELETING` |
| `membership_inactive` | 403 | membresía `INACTIVE` |
| `forbidden` | 403 | permiso insuficiente |
| `not_found` | 404 | genérico |
| `invitation_not_found` | 404 | invitación inexistente/sin autoridad |
| `user_not_found` | 404 | usuario inexistente |
| `email_already_registered` | 409 | email global ya registrado (register) |
| `already_member` | 409 | usuario ya es miembro del tenant |
| `invitation_pending` | 409 | ya existe invitación PENDING para ese email+tenant |
| `email_in_use` | 409 | email en uso (invite a email registrado) |
| `conflict` | 409 | conflicto genérico |
| `rate_limited` | 429 | throttle superado |
| `external_provider_error` | 502 | error de proveedor externo (WhatsApp/embeddings) |
| `llm_error` | 502 | error de proveedor LLM |
| `database_error` | 500 | error de persistencia |
| `internal_server_error` | 500 | error no clasificado |

> El nombre/organización del catálogo (no todos los códigos existen aún como endpoint) sigue `docs/api/authentication.md §11`, ampliado con códigos operativos (`conflict`, `rate_limited`, `external_provider_error`, `llm_error`, `database_error`, `internal_server_error`).

---

## 3. Dominio de errores (`domain/errors`)

Regla normativa aplicada (`dependency-rules.md`): **el dominio no depende de `packages/contracts`** ("Domain nunca depende de contracts de transporte"). Consecuencia de diseño:

- El domino define su **propio** union de códigos (`DomainErrorCode`) estructuralmente idéntico al catálogo de contracts.
- El mapeo dominio→wire sucede **una sola vez**, en el `AllExceptionsFilter` (capa Presentation).
- El `as DomainErrorCode as ApiErrorCode` al construir la respuesta es un **cast estructural seguro** (mismo conjunto de literales), documentado en el código para obligar a mantener sincronizados ambos catálogos.

### 3.1 Jerarquía

```
Error (JS)
└── AppError (abstracto)                       domain/errors/app-error.ts
    ├── status: number  (HTTP status del dominio)
    ├── code: DomainErrorCode
    ├── message: string
    └── details?: unknown
    ├── ValidationError         400  validation_error
    ├── AuthenticationError     401  invalid_credentials (opcional: invalid_refresh_token, token_expired, reuse_detected)
    ├── AuthorizationError      403  forbidden (opcional: account_disabled, tenant_inactive, membership_inactive)
    ├── NotFoundError           404  not_found (opcional: invitation_not_found, user_not_found)
    ├── ConflictError           409  conflict (opcional: email_already_registered, already_member, invitation_pending, email_in_use)
    ├── RateLimitError          429  rate_limited
    ├── ExternalProviderError   502  external_provider_error
    ├── LlmError                502  llm_error
    ├── DatabaseError           500  database_error
    └── InternalServerError     500  internal_server_error
```

Patrón de subclase (todas en `index.ts`):

```ts
export class ConflictError extends AppError {
  readonly status = 409;
  constructor(code: DomainErrorCode = "conflict", message = "…", details?: unknown) {
    super(code, message, details);
  }
}
```

Las subclases permiten códigos específicos por constructor (p. ej. `new ConflictError("email_in_use", …)`), de modo que el **status lo fija la clase** y el **código de wire lo especializa el constructor** — así el mapeo sigue siendo un punto único pero expresivo.

**Detalles técnicos:**
- El dominio no importa NestJS ni Prisma ni `contracts` (cumple `dependency-rules.md`).
- `name` se fija a la clase concreta (`new.target.name`) para logs legibles.
- `details` es opcional y libre (no serializado por el logger; sí por el filter cuando aplica).

### 3.2 Archivos

| Archivo | Contenido |
|---|---|
| `apps/api/src/domain/errors/app-error.ts` | `DomainErrorCode` union + `AppError` abstracto |
| `apps/api/src/domain/errors/index.ts` | 10 subclases concretas + re-export de base/tipo |

---

## 4. Exception filter global

`apps/api/src/common/filters/all-exceptions.filter.ts`

### 4.1 Registro

Vía provider `{ provide: APP_FILTER, useClass: AllExceptionsFilter }` en `AppModule` (no `useGlobalFilters` en bootstrap). Motivo: el registro por `APP_FILTER` habilita eager instantiation consistente con el ciclo de vida de Nest y permite evolucionarlo a inyección de dependencias si se requiere.

### 4.2 Resolución de errores (función `resolve`)

Orden de evaluación estricto:

1. **`instanceof AppError`** → `{ status: err.status, code: err.code, message: err.message, details?, serverError: status >= 500 }`.
2. **`instanceof HttpException`** → status real con código derivado por tabla:
   | status | código |
   |---|---|
   | 400 | `validation_error` |
   | 401 | `invalid_credentials` |
   | 403 | `forbidden` |
   | 404 | `not_found` |
   | 409 | `conflict` |
   | 429 | `rate_limited` |
   | 502 | `external_provider_error` |
   | resto (incl. 500) | `internal_server_error` |
   El `message` se extrae de `getResponse()`: string → tal cual; `{ message: string \| string[] }` → `join(". ")` si es array.
3. **Cualquier otra cosa** (errores no manejados) → `500 internal_server_error` / `"Error interno del servidor"` (mensaje fijo, **sin filtrar stack internos al cliente**).

### 4.3 Envelope y correlación

```json
{
  "code": "not_found",
  "message": "Cannot GET /api/no-existe",
  "requestId": "33821fa8-3094-4a03-801f-5cac19263118"
}
```

- `requestId` se lee de `getCorrelationId()` (`AsyncLocalStorage`, pre-existente). La inclusión es **condicional** (el objeto no lleva `requestId: undefined`).
- El header `x-request-id` ya lo emite `CorrelationIdMiddleware` — no se duplicó en el filter.
- `details` también es condicional; si el dominio no lo provee, no aparece en el body (evita ruido).

### 4.4 Logging

`StructuredLogger` (instanciado directo en el filter, mismo patrón que bootstrap):
- error `>= 500` → `logger.error(message, context, meta)`.
- cliente (`< 500`) → `logger.warn(message, context, meta)`.

`meta` = `{ status, code, path, details?, stack? }`. El stack **solo va al log**, nunca al body. `path` se construye como `METHOD url` desde el request de Express.

---

## 5. Validación de entrada

`apps/api/src/main.ts`:

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

| Opción | Efecto | Justificación |
|---|---|---|
| `whitelist` | descarta propiedades sin decorador | evita mass-assignment por defecto |
| `forbidNonWhitelisted` | 400 `validation_error` si hay props extra | fail-fast: errores explícitos > silenciamiento |
| `transform` | instancia DTOs / castea primitivos por `design:type` | hace cumplir tipos y habilita `class-transformer` |

Nota de diseño: no se habilitó `transformOptions.enableImplicitConversion` — las conversiones implícitas de strings a números en query/params se decidirán por DTO explícito en los endpoints (M-4/M-5), no por default global.

---

## 6. Swagger / OpenAPI

`apps/api/src/common/swagger/swagger.setup.ts`:

```ts
new DocumentBuilder()
  .setTitle("negocIA API")
  .setDescription("API del SaaS negocIA — Fase 1 (identidad)")
  .setVersion("0.1.0")
  .addBearerAuth()
  .build();
```

- Ruta: `SwaggerModule.setup("api/docs", app, document)` → `GET /api/docs` (ui) y `GET /api/docs-json` (spec). El path de Swagger es monatje absoluto (no le aplica el prefix global).
- **Plugin de generación**: `nest-cli.json` → `compilerOptions.plugins: ["@nestjs/swagger"]`. Efecto: decoradores `@ApiProperty` auto-inferidos de los DTOs/`class-validator`, `@ApiOperation` de comentarios JSDoc, `@ApiResponse` de tipos de retorno — sin boilerplate manual.
- El security scheme `bearer` se registra a nivel de spec; su aplicación por endpoint llegará con los guards (M-4).

---

## 7. Rate limiting

`apps/api/src/app.module.ts`:

```ts
ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])   // default global
providers:
  { provide: APP_GUARD, useClass: ThrottlerGuard }          // guard global
```

`apps/api/src/modules/health/health.controller.ts`: `@SkipThrottle()` a nivel de controller (health no debe degradarse por monitoreo).

Decisiones y límites conocidos:

- `ttl: 60_000`, `limit: 100` son **defaults provisionales**; los endpoints sensibles (login/invitaciones/resend) se ajustarán en M-4/M-5 con `@Throttle` por-route (p. ej. login 5/min por IP).
- Storage **in-memory** (candidato a Redis cuando haya multi-instancia; la tabla de sesiones ya vive en PG, el rate state no es crítico en MVP single-instance).
- Limitación técnica verificada: **el `ThrottlerGuard` solo se ejecuta para rutas existentes** — un 404 por ruta inexistente no pasa por el guard (Nest resuelve la ruta antes). Por eso el burst de prueba sobre `/api/no-existe` dio 110×404 sin 429. La verificación funcional del 429 quedará para M-4 (endpoint `POST /v1/auth/login`).

---

## 8. Gestión de dependencias

### 8.1 Versiones finales (`apps/api/package.json`)

| Paquete | Versión | Registro (modificado) | Política `minimumReleaseAge` |
|---|---|---|---|
| `class-validator` | `^0.15.1` | 2026-02-26 | conforme (estable) |
| `class-transformer` | `0.5.1` | 2022-12-09 | conforme (estable) |
| `@nestjs/swagger` | `12.0.1` | 2026-08-28 | **12.0.2 (2026-09-23 06:48Z) bloqueada** → pin previo |
| `@nestjs/throttler` | `^6.7.0` | 2026-09-17 | conforme (6 días) |

`@nestjs/swagger@12.0.1` fue elegido tras auditar el historial de publicación: `12.0.2` cayó dentro de la ventana de 24 h del `minimumReleaseAge` de pnpm (mismo criterio que NestJS 12.0.4 en el foundation).

### 8.2 Incidente `ERR_PNPM_IGNORED_BUILDS`

- Síntoma: primer `pnpm install --filter @negocia/api...` falla con `Ignored build scripts: @scarf/scarf@1.4.0`.
- Causa: `@scarf/scarf` (postinstall `report.js`, telemetría de `@nestjs/swagger`) no estaba en `allowBuilds` de `pnpm-workspace.yaml`.
- Primer intento: mapearlo a `ignoredBuiltDependencies` → **no surtió efecto** porque el fast-path del lockfile reusa estado y no re-evalúa el config.
- Resolución: `allowBuilds: { "@scarf/scarf": true }`. El postinstall de scarf es benigno (recolecta metadata de herramienta para telemetría anónima opcional) y tolerable en dev.
- Observación operativa: durante el fallo, **pnpm reescribe `pnpm-workspace.yaml`** con un placeholder corrupto (`'@scarf/scarf': set this to true or false`) — limpiar el archivo al tratar incidentes de builds.

---

## 9. Boot: observaciones

Único warning al arranque (pre-existente):

```
Unsupported route path: "/api/*" ... latest version of "path-to-regexp" ...
Attempting to auto-convert to "/api/{*path}" ...
```

Origen: `CorrelationIdMiddleware` registrado con `forRoutes("*")` (Nest traduce a `*`). Auto-conversión exitosa, sin impacto funcional. Se documenta para decidir en un futuro hardening el `forRoutes("{*path}")` explícito.

---

## 10. Archivos del hito

| Archivo | Cambio |
|---|---|
| `packages/contracts/src/index.ts` | `API_ERROR_CODES` (22), `ApiErrorCode`, `ApiError{code,message,details?,requestId?}`, `ListResponse<T>`; se mantienen `ApiEnvelope`, `HealthResponse`, `API_PREFIX` |
| `apps/api/src/domain/errors/app-error.ts` | nuevo: `DomainErrorCode` + `AppError` |
| `apps/api/src/domain/errors/index.ts` | nuevo: 10 subclases |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | nuevo: `AllExceptionsFilter` |
| `apps/api/src/common/swagger/swagger.setup.ts` | nuevo: `setupSwagger` |
| `apps/api/src/main.ts` | `ValidationPipe` global + `setupSwagger` |
| `apps/api/src/app.module.ts` | `ThrottlerModule.forRoot`, providers `APP_FILTER` + `APP_GUARD` |
| `apps/api/src/modules/health/health.controller.ts` | `@SkipThrottle()` |
| `apps/api/nest-cli.json` | plugin `@nestjs/swagger` |
| `apps/api/package.json` | +4 dependencias runtime |
| `pnpm-workspace.yaml` | `@scarf/scarf: true` en `allowBuilds` |
| `docs/infrastructure/local-development.md` | sección API (errores, validación, Swagger, throttler), árbol `src/`, nota `allowBuilds` |
| `docs/infrastructure/informe-implementacion-fundacion.md` | §13.5 (checkpoint M-2) + §13.6 (próximo M-3) |

---

## 11. Verificación

### 11.1 Calidad estática

| Pipeline | Resultado | Contexto |
|---|---|---|
| `pnpm build` | **5/5** | api (nest build + plugin swagger), contracts, config, database, web |
| `pnpm typecheck` | **8/8** | tsc --noEmit en todos |
| `pnpm lint` | **8/8** | eslint flat en todos |

### 11.2 Smoke tests (API local, infra Docker healthy)

| Criterio | Método | Resultado |
|---|---|---|
| Health | `GET /api/health` | `200` `{"status":"ok","service":"negocia-api",...,"requestId":"…"}` |
| Envelope 404 | `GET /api/no-existe` | `404` `{"code":"not_found","message":"Cannot GET /api/no-existe","requestId":"…"}` |
| Header correlación | `curl -D - /api/no-existe` | `x-request-id: <uuid>` presente |
| Swagger UI | `GET /api/docs` | `200 text/html` con `#swagger-ui` |
| Spec OpenAPI | `GET /api/docs-json` | `200` con `securitySchemes.bearer` y `paths` con `/api/health` |
| Throttle 429 | burst 110× `/api/no-existe` | **110×404** (ver §7: guard no aplica a rutas inexistentes; verificación real en M-4) |

---

## 12. Decisiones registradas (minutas técnicas)

1. **Catálogo cerrado en `contracts` + union paralela en dominio** (sin import dar dominio→contracts): el filtro ejecuta el único cast; ambos catálogos deben crecer en tándem (comentario de código + esta minuta).
2. **Mensaje de errores no manejados fijo** ("Error interno del servidor") — el detalle va solo al log.
3. **`details`/`requestId` condicionales** en el envelope: un objeto de error mínimo jamás lleva campos `undefined`.
4. **Subclases expresivas** (código por constructor, status por clase): fase de mapeo única sin switch gigante.
5. **`APP_FILTER`/`APP_GUARD` por provider en `AppModule`** en vez de `useGlobalX` en bootstrap: integración DI nativa para evolución posterior (p. ej. guard que inyecte repos).
6. **Sin `enableImplicitConversion`** en el ValidationPipe global: conversiones tipadas solo por DTO.
7. **Swagger vía plugin de compilación** (`@nestjs/swagger` en `plugins`): documentación auto-derivada de DTOs en M-4/M-5 sin decoradores repetidos.
8. **Defaults de throttle provisionales** (100/60s) a calibrar por-route en endpoints sensibles; storage in-memory evaluado como suficiente para monopolito single-instance.
9. **`@SkipThrottle()` en health** por SemVer operacional: el endpoint de liveness nunca debe degradarse por su propia existencia.

---

## 13. Desviaciones y temas abiertos

1. **`dependency-rules.md:34` dice "el ENV usa Zod"** pero seguimos con `validateEnv`/`@negocia/config` (decisión deliberada previa; registrada en informe §13.5). Acción futura: actualizar el documento normativo o migrar, como parte de M-3/M-4.
2. **`forRoutes("*")`** genera warning de path-to-regexp (auto-convertido). Opcional: normalizar a `{*path}`.
3. **429 por throttle pendiente de verificación funcional real** → M-4 (`POST /v1/auth/login`).

---

## 14. Próximo paso

**M-3 — Puertos de dominio**: `PasswordHasher` (Argon2id), `EmailSender` (mock dev), `TokenHasher` (SHA-256), `IdGenerator`; `PlanCatalog` + `LimitsService` (validación `max_users` al invitar, ADR-007); lógica pura de rotación/reuse de refresh (testeable puro). Deps a incorporar: `jose` + `argon2` (este último requiere agregarlo a `allowBuilds`). Runner de tests: **Vitest**.