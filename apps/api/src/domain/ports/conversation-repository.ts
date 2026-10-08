import type {
  ConversationRecord,
  ConversationStatus,
  DeliveryStatusUpdate,
  InboundMessageDraft,
  MessageRecord,
  OutboundMessageDraft,
} from "../conversations/entities";

export interface ConversationPage<T> {
  items: T[];
  total: number;
}

export interface ListConversationsOptions {
  limit: number;
  offset: number;
  status?: ConversationStatus;
}

export interface ListMessagesOptions {
  limit: number;
  offset: number;
}

/**
 * Repositorio de conversaciones y mensajes del canal (F2-4).
 *
 * `recordInboundMessage` es la única operación de escritura del hito y la más
 * delicada: persiste la conversación (find-or-create por `tenant + cuenta +
 * cliente`) y el mensaje **atómicamente**. La idempotencia de reenvíos de Meta
 * vive en `messages.provider_message_id` (UNIQUE global) y en que la transacción
 * devuelve `"duplicated"` si otro proceso ya insertó la misma pieza —
 * exactamente la misma frontera que `whatsapp_events`.
 */
export interface ConversationRepository {
  findById(
    tenantId: string,
    id: string,
  ): Promise<ConversationRecord | null>;

  listByTenant(
    tenantId: string,
    options: ListConversationsOptions,
  ): Promise<ConversationPage<ConversationRecord>>;

  /**
   * `"duplicated"` = el `providerMessageId` ya existía (reenvío de Meta): la
   * transacción entera se deshace y no se reescribe nada.
   */
  recordInboundMessage(
    scope: { tenantId: string; accountId: string },
    draft: InboundMessageDraft,
  ): Promise<{ conversation: ConversationRecord; message: MessageRecord } | "duplicated">;

  /**
   * Aplica un `statuses[].status` de Meta al mensaje que le corresponde.
   * Devuelve `false` (no-op) si el mensaje aún no existe: los ACKs pueden
   * llegar antes que la pieza que confirman.
   */
  recordDeliveryStatus(
    tenantId: string,
    update: DeliveryStatusUpdate,
  ): Promise<boolean>;

  /**
   * Persiste un mensaje `OUTBOUND` ya enviado (M8) y actualiza
   * `last_message_at` de la conversación. El `providerMessageId` es el `wamid`
   * que Meta devuelve del send; si ya existe (reintento del mismo send), devuelve
   * el mensaje existente sin duplicar la fila.
   */
  recordOutboundMessage(
    scope: { tenantId: string; conversationId: string },
    draft: OutboundMessageDraft,
  ): Promise<MessageRecord>;

  getConversation(tenantId: string, conversationId: string): Promise<ConversationRecord>;

  transitionStatus(
    tenantId: string,
    conversationId: string,
    from: string,
    to: string,
  ): Promise<ConversationRecord | null>;

  listRecentMessages(
    tenantId: string,
    conversationId: string,
    take: number,
  ): Promise<MessageRecord[]>;

  listMessages(
    tenantId: string,
    conversationId: string,
    options: ListMessagesOptions,
  ): Promise<ConversationPage<MessageRecord>>;
}
