import type {
  CreateWhatsappEventDraft,
  WhatsappEventRecord,
} from "../whatsapp/entities";

/**
 * Repositorio de eventos crudos del webhook de Meta.
 *
 * `provider_event_id` es UNIQUE global (docs/database/schema.md §10): es la
 * frontera de idempotencia que impide que un reenvío de Meta genere un segundo
 * mensaje/pedido/envío. `create` devuelve `null` si otro proceso insertó la
 * misma fila en paralelo (P2002), y las transiciones de status usan
 * `updateMany` con el status anterior en el `where` para ser seguras bajo
 * concurrencia.
 */
export interface WhatsappEventRepository {
  findByProviderEventId(
    providerEventId: string,
  ): Promise<WhatsappEventRecord | null>;
  /** `null` = carrera: otro proceso insertó el mismo `provider_event_id`. */
  create(draft: CreateWhatsappEventDraft): Promise<WhatsappEventRecord | null>;
  /** `RECEIVED | FAILED → ENQUEUED` (transición idempotente bajo carrera). */
  markEnqueued(id: string): Promise<void>;
  /** `ENQUEUED → PROCESSED`; lo consume el worker. */
  markProcessed(id: string, processedAt: Date): Promise<void>;
  /** `RECEIVED | ENQUEUED → FAILED` (fallo de enqueue; redelivery reintentará). */
  markFailed(id: string): Promise<void>;
}