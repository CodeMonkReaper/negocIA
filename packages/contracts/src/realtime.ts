/**
 * Eventos en tiempo real (SSE) para el panel.
 *
 * El servidor publica estos eventos en Redis (`negocia:realtime`) y los
 * re-emite por `text/event-stream` a los clientes del tenant. El cliente web
 * los usa para refrescar conversaciones/runs sin polling agresivo.
 */
export type RealtimeEventType = "conversation.changed" | "account.changed";

export interface RealtimeEventDto {
  event: RealtimeEventType;
  tenantId: string;
  at: string;
  conversationId?: string;
  accountId?: string;
}