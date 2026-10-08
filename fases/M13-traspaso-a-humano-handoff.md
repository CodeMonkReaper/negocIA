# M13 — F6-3: traspaso a humano (handoff y transiciones de conversación)

| Campo | Valor |
|---|---|
| Fase | Fase 2 / Fase 3 — F6-3 (traspaso a humano / handoff) |
| Fecha | 08/10/2026 |
| Estado | **Completo** en código y verificado (`pnpm verify` verde) |
| Referencias normativas | `docs/capacidades-actuales.md`, `docs/pendiente-fase-2.md`, `fases/M12-realtime-sse.md` §8 |

## 1. Contexto y objetivo

Las fases M8 y M12 establecieron la máquina de estados pura en `domain/conversations/state-machine.ts` y el canal de tiempo real por SSE para notificar cambios de estado (`conversation.changed`), pero la API carecía de endpoints para que un agente humano tome una conversación del bot (`TAKE`) o la devuelva a la IA (`RETURN_TO_BOT`).

Este hito materializa el traspaso a humano (*handoff*):
1. Expone `POST /api/v1/conversations/:id/transition` con autorización por rol (`OWNER`, `ADMIN`, `AGENT`).
2. Valida la aplicabilidad de la acción según el estado actual de la conversación (`BOT_ACTIVE`, `HUMAN_REQUESTED`, `HUMAN_ACTIVE`).
3. Actualiza el estado en PostgreSQL de forma atómica con verificación optimista de concurrencia (`WHERE status = :currentStatus`).
4. Publica el evento `conversation.changed` por Redis pub/sub para que el panel web actualice el badge de estado en tiempo real vía SSE.
5. Integra los controles de acción en el panel web (`apps/web`): botones "Tomar conversación", "Atender ahora" y "Devolver al bot" en la vista de detalle de conversación.

### Criterios de done

1. DTOs y tipos en `@negocia/contracts`: `ConversationAction` (`"TAKE" | "RETURN_TO_BOT"`), `TransitionConversationDto`, `ConversationStatusResponseDto`.
2. Endpoint `POST /api/v1/conversations/:id/transition` en `apps/api` con `@HttpCode(HttpStatus.OK)`.
3. Repositorio `ConversationRepository.transitionStatus` con aislamiento estricto por tenant y estado previo.
4. Servicio `ConversationsService.transitionConversation` que orquesta la máquina de estados, persiste y publica el evento en tiempo real.
5. Cliente API de la web (`apps/web/lib/api.ts`) con el método `transitionConversation`.
6. Interfaz web en `apps/web/app/(app)/conversations/[id]/page.tsx` con botones de transición según estado actual y manejo de errores.
7. Suite de pruebas unitarias (288 tests), de integración (61 tests) y e2e (117 tests) verdes.
8. `pnpm verify` pasando íntegro (exit 0).

## 2. Decisiones de diseño

- **Transiciones soportadas**:
  - `TAKE` sobre `BOT_ACTIVE` → pasa a `HUMAN_REQUESTED` (notificación de que un humano intervendrá).
  - `TAKE` sobre `HUMAN_REQUESTED` → pasa a `HUMAN_ACTIVE` (el humano está atendiendo activamente).
  - `RETURN_TO_BOT` sobre `HUMAN_ACTIVE` o `HUMAN_REQUESTED` → devuelve a `BOT_ACTIVE` (el bot reanuda la atención).
  - Cualquier acción sobre un estado incompatible arroja `404 Not Found` (diseño *fail-safe* y multi-tenant: no distingue si no existe o no aplica para no filtrar información).
- **Concurrencia segura**: El método `transitionStatus` del repositorio ejecuta `UPDATE ... WHERE id = :id AND tenant_id = :tenantId AND status = :fromStatus`. Si dos agentes o un worker compiten, solo uno gana y el otro recibe `null` (resultando en 404).
- **Publicación de eventos**: Tras la actualización exitosa, se emite `conversation.changed` por `EventPublisher`, distribuyéndose instantáneamente a las pestañas conectadas vía SSE.
- **Degradación y UX en Frontend**: Los botones muestran estado deshabilitado durante la petición (`transitioning`) y reflejan el nuevo estado de forma optimista mientras SSE confirma la actualización.

## 3. Inventario de archivos modificados

### Backend y Contratos
- `packages/contracts/src/whatsapp.ts`: Contratos `ConversationAction`, `TransitionConversationDto`, `ConversationStatusResponseDto`.
- `apps/api/src/domain/ports/conversation-repository.ts`: Firma de `transitionStatus`.
- `apps/api/src/infrastructure/database/repositories/prisma-conversation.repository.ts`: Implementación de actualización condicionada por tenant y estado `from`.
- `apps/api/src/modules/conversations/application/conversations.service.ts`: Lógica de validación de transiciones, persistencia y emisión de eventos.
- `apps/api/src/modules/conversations/presentation/conversations.controller.ts`: Endpoint `POST :id/transition` con `@HttpCode(200)`.
- `apps/api/src/modules/conversations/presentation/dto/transition-conversation.dto.ts`: DTO con `class-validator` `@IsIn(CONVERSATION_ACTIONS)`.
- `apps/api/src/modules/conversations/presentation/conversation.mapper.ts`: Mapper `toConversationStatusResponseDto`.

### Frontend Web
- `apps/web/lib/api.ts`: Método `transitionConversation`.
- `apps/web/app/(app)/conversations/[id]/page.tsx`: Botones de acción dinámica en cabecera ("Tomar conversación", "Atender ahora", "Devolver al bot").

### Pruebas
- `apps/api/src/modules/conversations/application/conversations.service.spec.ts`: Tests unitarios de transiciones válidas, inválidas y condiciones de carrera.
- `apps/api/test/conversations.integration.spec.ts`: Tests de integración en base de datos PostgreSQL real con aislamiento de tenant.
- `apps/api/test/conversations.e2e-spec.ts`: Tests e2e vía HTTP Supertest de los flujos de transición, autenticación y validación de parámetros.

## 4. Verificación

```bash
pnpm verify
```
- Lint: 0 errores.
- Typecheck: 0 errores.
- Build: 5/5 paquetes construidos correctamente.
- Tests Unitarios: 288 aprobados, 4 omitidos.
- Tests Integración: 61/61 aprobados.
- Tests E2E: 117/117 aprobados.
- Healthcheck de DB: Conexión a PostgreSQL 17 OK.

## 5. Próximo paso

**F3-3b (Tools de negocio en `ToolCatalog` y catálogo de productos/servicios)**:
Actualmente el agente de IA conversa pero carece de herramientas de ejecución. El siguiente paso es implementar las primeras tools en `ToolCatalog` (búsqueda de catálogo, consulta de disponibilidad) conectadas al modelo de datos del negocio.

