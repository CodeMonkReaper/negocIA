# 1. Objetivo

Fijar las reglas de dependencia del monorepo y de las capas lógicas, para que la arquitectura sea testable, de bajo acoplamiento y fácil de evolucionar.

El contenido de este documento es **normativo**: cualquier código que lo viole se marca como error de diseño.

# 2. Capas lógicas (sentido de dependencia)

```text
Presentation  →  Application  →  Domain
      ↓              ↓              ↓
        (todas pueden depender de) Infrastructure directo NO permitido
```

Reglas por capa:

| Capa | Puede depender de | No puede depender de |
|---|---|---|
| **Presentation** (controllers, guards, DTOs) | Application, Domain, Shared | Infrastructure (Prisma, Redis, HTTP externos, SDKs) |
| **Application** (casos de uso, servicios) | Domain, Shared | Infrastructure directa (solo a través de puertos) |
| **Domain** (entidades, reglas, puertos, errores) | nada externo / sólo lógica pura | Librerías externas, NestJS, Prisma, frameworks |
| **Infrastructure** (adapters, PrismaService, Redis, SDKs) | Domain, Shared (implementa puertos) | — |

Excepciones controladas:

- NestJS DI registra implementaciones de puertos (el `config`-binder es infraestructura).
- `packages/contracts` (tipos de wire) es compartido y no pertenece al dominio: Presentation define/los aplica; Domain nunca depende de contracts de transporte.

# 3. Reglas dentro de apps/api

1. Ningún controller contiene lógica de negocio (solo validación de entrada + llamada a caso de uso + mapeo de respuesta).
2. Ningún caso de uso accede directamente a la BD si puede usar un puerto/repositorio. Si se usa Prisma directamente, es responsabilidad del módulo de infraestructura (repositorios) o de casos de uso con autorización garantizada por guard — decisión formal: los casos de uso reciben repositorios/interfaces, no el PrismaClient global sin mediar.
3. Los errores se clasifican en `domain/errors` (Validation, Authorization, NotFound, Conflict, ExternalProvider, LLM, Database, RateLimit) y se mapean a HTTP en un único `ExceptionFilter`.
4. Los DTOs de entrada usan `class-validator` (pipes de NestJS); el ENV usa `validateEnv` de `@negocia/config`; **no se duplica** la validación.
   - *Nota (2026-09-30):* esta línea decía "Zod". `validateEnv` está implementado sin Zod (validación explícita y tipada por campo) y es lo que corre en producción y en las tres suites. Zod queda **descartado por decisión**, no pendiente: añadir una segunda librería de validación para el mismo entorno contradice el "no se duplica" de esta misma regla. Ver `docs/adr/009-env-validation-strategy.md`.
5. El `TenantContext` se lee del módulo de contexto; nunca se reconstruye desde el body/query.

# 4. Reglas de dependencia entre paquetes del monorepo

```text
apps/api  ──►  packages/database, packages/contracts, packages/config, packages/eslint-config
apps/web  ──►  packages/contracts, packages/config, packages/eslint-config
                                        (NO a packages/database)
```

| Paquete | Importable desde | Prohibido |
|---|---|---|
| `packages/contracts` | apps/api y apps/web | — |
| `packages/database` | apps/api (y futuros workers) | **apps/web / frontend** |

**El frontend no consume modelos Prisma.** `apps/web` opera solo con `packages/contracts` (schemas de wire: request/response tipos, DTOs). El API define los schemas y los expone; el frontend los consume por contrato. Esto evita acoplar la UI a la persistencia y permite evolucionar la BD sin romper el cliente.

# 5. Puertos vs implementaciones (ports & adapters)

| Puertos (domain) | Adapters (infrastructure) |
|---|---|
| `PasswordHasher` | `Argon2PasswordHasher` (`argon2`) |
| `EmailSender` | `MockEmailAdapter` (`EMAIL_DRIVER=mock`, dev/test) → `ResendEmailAdapter` (SDK `resend`, producción; ADR-009) |
| `RefreshTokenRepository` | `PrismaRefreshTokenRepository` |
| `UserRepository` | `PrismaUserRepository` |
| `TenantRepository` | `PrismaTenantRepository` |
| `MembershipRepository` | `PrismaMembershipRepository` |
| `InvitationRepository` | `PrismaInvitationRepository` |
| `WhatsappAccountRepository` | `PrismaWhatsappAccountRepository` |
| `WhatsappEventRepository` | `PrismaWhatsappEventRepository` |
| `WhatsappEventQueuer` (BullMQ) | `BullWhatsappEventQueue` (ioredis; worker separado `start:worker`) |
| `DependencyProbe` | `PrismaDependencyProbe` · `RedisDependencyProbe` (array `DEPENDENCY_PROBES`, Q4) |
| `LlmProvider` (F3-3) | `MockLlmAdapter` (`LLM_DRIVER=mock`, dev/test) → `OpenRouterLlmAdapter` (`fetch` nativo, producción; ADR-011) |
| `WhatsAppProvider` (Fase 2) | `MetaCloudProvider` |

Los servicios de aplicación dependen de los **puertos**, no de Prisma ni SDKs.

# 6. Reglas para workers y procesos asíncronos

- El worker recibe `job.payload.tenantId` explícito y lo **valida** antes de crear el `TenantContext` (nunca lee tenant del entorno del proceso).
- El handler del job no contiene lógica de negocio: delega en el mismo caso de uso/application service que usa HTTP.
- Reintentos: errors permanentes → `job.moveToFailed`; reintentables → `backoff` de BullMQ con límite y DLQ (dead letter queue) si corresponde.
- M7/M8 (canal entrante + conversaciones): el worker es un proceso **separado** (`pnpm start:worker` →
  `node dist/worker/main.js`, mismo `apps/api`), consume `whatsapp-events` con `concurrency` 5;
  desde M8 **procesa negocio** delegando en `ConversationsService.ingestInbound` (persistencia
  idempotente + `delivery_status`) antes de `markProcessed`; el web server nunca procesa mensajes.

# 7. Diseño funcional futuro obligatorio desde Fase 1

- Los servicios de dominio/application de Fase 1 ya reciben `TenantContext`; así las operaciones tenant-scoped posteriores (conversaciones, agenda) siguen el mismo patrón sin refactor.
- No introducir microservicios hasta que exista una razón operacional real.