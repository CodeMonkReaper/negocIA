/**
 * Encolador de eventos de WhatsApp.
 *
 * El webhook de Meta responde rápido (persistir/dedup → cola → HTTP 200) y el
 * procesamiento pesado (más adelante: motor de conversación/LLM) ocurre fuera
 * del request. Este puerto es la frontera entre el caso de uso y la cola, de
 * modo que el webhook service testea con un doble y BullMQ es solo una
 * implementación más (docs/architecture/whatsapp.md §webhook).
 */
export interface WhatsappEventQueuer {
  /** Encola el evento de WhatsApp por su `provider_event_id`. */
  enqueue(providerEventId: string): Promise<void>;
}