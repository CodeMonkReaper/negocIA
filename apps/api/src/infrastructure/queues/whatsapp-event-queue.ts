import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { WhatsappEventQueuer } from "../../domain/ports/whatsapp-event-queuer";

export const WHATSAPP_EVENTS_QUEUE = "whatsapp-events";

/**
 * Encolador de eventos de WhatsApp sobre BullMQ (Redis).
 *
 * - `jobId: provider_event_id` → BullMQ no acepta dos jobs con el mismo id:
 *   la deduplicación tiene dos capas (la UNIQUE de `whatsapp_events` y esta).
 * - `attempts` + backoff exponencial: un fallo transitorio del worker no pierde
 *   el evento; el redelivery de Meta es la red de seguridad de más afuera.
 *
 * BullMQ exige un cliente ioredis (no solo la URL) para tipar `connection`; se
 * pasa a `maxRetriesPerRequest: null` porque "sin reintentos" es la semántica
 * correcta para un productor: si Redis cae, `enqueue` falla ya y el estado lo
 * registra el webhook service como `FAILED`, no lo reintenta el cliente.
 */
@Injectable()
export class BullWhatsappEventQueue implements WhatsappEventQueuer, OnModuleDestroy {
  private readonly queue: Queue;

  constructor(connectionString: string) {
    this.queue = new Queue(WHATSAPP_EVENTS_QUEUE, {
      connection: new Redis(connectionString, {
        maxRetriesPerRequest: null,
        connectTimeout: 1_000,
        commandTimeout: 1_000,
      }),
    });
  }

  async enqueue(providerEventId: string): Promise<void> {
    await this.queue.add(
      "process-event",
      { providerEventId },
      {
        jobId: providerEventId,
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}