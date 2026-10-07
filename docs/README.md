# Docs — SaaS IA para WhatsApp

Índice de artifacts de diseño y decisiones arquitectónicas del proyecto (multi-tenant, B2B, PyMEs de Chile y LATAM).

Estos artifacts se mantienen **sincronizados con la implementación**. Si cambia el código, cambia el artifact; si cambia el artifact, cambia el código.

## Cómo leer

1. Empieza por `architecture/overview.md` (visión de sistema).
2. Sigue con `architecture/multi-tenancy.md` y `architecture/tenant-context.md` (aislamiento y propagación de contexto).
3. Luego `architecture/authentication.md` y `api/authentication.md` (flujos de identidad).
4. Revisa `database/schema.md` para el modelo de datos.
5. Las decisiones con impacto arquitectónico se registran como ADRs (`adr/`).
6. Canal de mensajería entrante: `architecture/whatsapp.md` + `api/webhooks.md` + `adr/010-…`.
7. Embedded Signup + envío real + cifrado: `adr/012-embedded-signup-envio-real-cifrado-tokens.md` + `api/conversations.md` + `architecture/whatsapp.md`.
8. Proveedor de IA: `adr/011-llm-provider-openrouter.md` (puerto `LlmProvider`, drivers y por qué
   el motor de conversación todavía no existe).

## Índice

| Área | Artifact |
|---|---|
| Visión | `architecture/overview.md` |
| Multi-tenancy | `architecture/multi-tenancy.md` |
| Tenant context | `architecture/tenant-context.md` |
| Autenticación (diseño) | `architecture/authentication.md` |
| Reglas de dependencia | `architecture/dependency-rules.md` |
| Aislamiento / seguridad | `security/tenant-isolation.md` |
| Modelo de datos | `database/schema.md` |
| API autenticación | `api/authentication.md` |
| WhatsApp (arquitectura del canal) | `architecture/whatsapp.md` |
| API webhooks y cuentas | `api/webhooks.md` |
| API conversaciones y mensajes | `api/conversations.md` |
| Estado | `capacidades-actuales.md` · `pendiente-fase-2.md` |
| Contexto maestro | `../PROJECT_CONTEXT.md` (actual) · `legacy/project-context-diseno-original.md` (diseño original preservado) |
| ADRs | `adr/*.md` |

## Estado

- **Etapa:** MVP — **Fase 1 (identidad) cerrada** + **F2-1/F2-2 verdes** + **F2-3 (canal entrante
  WhatsApp) cerrado** + **F2-4 (conversaciones/mensajes) cerrado** + **M9 (Embedded Signup +
  envío real + cifrado de access_token, ADR-012) cerrado** + **F3-3a (proveedor de IA,
  ADR-011)** en código y verificación
  (webhook firmado + idempotencia + BullMQ/Redis + worker que persiste mensajes; ADR-010;
  OAuth Embedded Signup + callback público, `POST /v1/conversations/:id/messages`, `CryptoService`
  AES-256-GCM + `ENCRYPTION_KEY`; ADR-012; puerto `LlmProvider` con driver OpenRouter; ADR-011).
  Monorepo, base de datos, auth con rotación de refresh, onboarding, invitaciones, verificación
  de email, gestión de tenants/usuarios, email real, webhook WhatsApp, lectura/escritura de
  conversaciones, Embedded Signup, cifrado de tokens y proveedor de IA: todo implementado.
- **Código:** existe y está en `apps/api` (NestJS + worker `start:worker`), `apps/web` (Next.js,
  solo status panel), `packages/{config,contracts,database,eslint-config}`.
- Progreso por fases y verificación con `pnpm run verify`: ver `fases/README.md` y
  `docs/infrastructure/informe-implementacion-fundacion.md` (checkpoints §13.5–§13.8). Próximo
  hito: **F3-3b** — motor de conversación (cola `llm-jobs`, tools, handoff y `llm_runs`), que ya
  tiene el historial persistido y el proveedor cableado. Nota de numeración: el hito se renumeró de
  M8 a M9 porque `M8` ya identifica el hito de conversaciones (`PROJECT_CONTEXT.md` §33 D9).