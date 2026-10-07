# Fases — bitácora técnica de ejecución

Carpeta que documenta **todos los hitos de implementación** del proyecto negocIA.

## Convención de registro

Cada vez que se complete una tarea/milestone, se crea un documento en esta carpeta. Reglas:

1. **Un documento por entregable completado**, nombrado `M<n>-<slug>.md` (milestone) o `<slug>-<fecha>.md` (tareas discretas).
2. Debe ser **ultra detallado y técnico**, estilo ingeniería:
   - Contexto y objetivo del hito.
   - Alcance, criterios de "done" y exclusiones.
   - Diseño y decisiones técnicas (con fundamentación).
   - Inventario de archivos creados/modificados con referencias precisas.
   - Tablas de mapeo, versiones, dependencias y riesgos.
   - **Evidencia de verificación** (comandos + salidas relevantes).
   - Incidencias y resoluciones.
   - Lecciones aprendidas y trabajo futuro.
3. Cuando un hito modifica decisiones normativas (ADRs, dependency-rules, schema), se deja constancia cruzada del documento afectado.
4. El documento más reciente enlaza al estado "próximo paso" para trazabilidad.

## Índice

| Documento | Hito | Fecha | Estado |
|---|---|---|---|
| [M1-modelo-identidad.md](M1-modelo-identidad.md) | Fase 1 — modelo de datos `identity-core` | 24/09/2026 | Completo |
| [M2-infraestructura-api-comun.md](M2-infraestructura-api-comun.md) | Fase 1 — infraestructura de API común | 24/09/2026 | Completo |
| [M3-puertos-dominio-reglas-puras.md](M3-puertos-dominio-reglas-puras.md) | Fase 1 — puertos de dominio y reglas puras | 24/09/2026 | Completo |
| [M4-auth-tenant-context.md](M4-auth-tenant-context.md) | Fase 1 — auth, refresh con rotación y contexto de tenant | 29/09/2026 | Completo |
| [M5-cierre-fase-1.md](M5-cierre-fase-1.md) | Fase 1 — invitaciones, verificación de email, tenants y usuarios (cierre) | 30/09/2026 | Completo |
| [M6-fase-2-email-reset.md](M6-fase-2-email-reset.md) | Fase 2 — proveedor de email real (Resend) y recuperación de contraseña | 03/10/2026 | Completo |
| [M7-fase-2-whatsapp-canal-entrante.md](M7-fase-2-whatsapp-canal-entrante.md) | Fase 2 — canal de entrada WhatsApp Cloud API (webhook + cola + worker) | 03/10/2026 | Completo |
| [M8-fase-2-conversaciones-mensajes.md](M8-fase-2-conversaciones-mensajes.md) | Fase 2 — conversaciones y mensajes (persistencia idempotente + inbox de lectura) | 03/10/2026 | Completo |
| [M9-embedded-signup-envio-real.md](M9-embedded-signup-envio-real.md) | Fase 2 — Embedded Signup + envío real de WhatsApp + cifrado de access_token | 03/10/2026 | Completo (implementado; tests/documentación sincronizada) |
| [M10-llm-provider-openrouter.md](M10-llm-provider-openrouter.md) | Fase 3 — proveedor de IA `LlmProvider` + driver OpenRouter (F3-3a) | 03/10/2026 | Completo |

> **Numeración de hitos:** `M8` es el hito de conversaciones/mensajes (F2-4). El hito diferido de
> **Embedded Signup + envío real** que M7/M8 nombraban "M8" queda renumerado como **M9**
> (ver `PROJECT_CONTEXT.md` §33 D9). El proveedor de IA es **M10** porque `M9` ya está reservado.

## Estado

**Fase 1 (identidad) cerrada** + F2-1/F2-2 verdes (email Resend, forgot/reset) + **F2-3 canal
entrante en verde** (`META_DRIVER=mock` bloqueado en prod; webhook firmado+idempotente,
BullMQ/Redis — ADR-010) + **F2-4 conversaciones/mensajes en verde** (el worker persiste el
inbound con idempotencia `provider_message_id`; `GET /conversations` y
`GET /conversations/:id/messages`; máquina de estados pura sin endpoints de transición) +
**M9 Embedded Signup + envío real + cifrado de access_token en verde** (rutas OAuth Embedded Signup,
`POST /v1/conversations/:id/messages`, `CryptoService` AES-256-GCM, `ENCRYPTION_KEY`) +
**F3-3a proveedor de IA en verde** (puerto `LlmProvider` con drivers `mock`/`openrouter`,
`LLM_DRIVER` con `mock` bloqueado en prod — ADR-011; **sin consumidor todavía**).
Próximos hitos: **F3-3b** — motor de conversación (cola `llm-jobs`, tools, handoff y `llm_runs`,
que ya tiene historial persistido y el proveedor cableado). También en cola: **F3-1** (web
consumiendo la API) y los quick wins de seguridad/testing (F6-S1, F5-T1, F5-T3). Detalle y
orden por dependencias: `fases/M10-llm-provider-openrouter.md` §8 y `PROJECT_CONTEXT.md` §24.