import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { LLM_JOB_QUEUER, WHATSAPP_EVENT_REPOSITORY } from "../../common/di-tokens";
import type { WhatsappEventRepository } from "../../domain/ports/whatsapp-event-repository";
import type { LlmJobQueuer } from "../../domain/ports/llm-job-queuer";
import { ConversationsService } from "../../modules/conversations/application/conversations.service";
import { StructuredLogger } from "../../common/logger/structured-logger";
import { WHATSAPP_EVENTS_QUEUE } from "../queues/whatsapp-event-queue";

/**
 * Worker de la cola de eventos de WhatsApp (F2-4).
 *
 * Consume cada job del webhook y persiste el mensaje entrante en la
 * conversación del cliente (o aplica su `statuses[]`), luego marca el evento
 * `PROCESSED` y hace ACK. Idempotencia en dos niveles, igual que el resto del
 * canal:
 *   - `whatsapp_events.provider_event_id` UNIQUE evita encolar dos veces el
 *     mismo webhook;
 *   - `messages.provider_message_id` UNIQUE hace que reescribir la misma pieza
 *     (un job reintentado por BullMQ) sea un no-op y no un mensaje duplicado.
 *
 * Se ejecuta como **proceso separado** (`pnpm start:worker`, alineado con F3-2):
 * el worker no debe compartir la vida de un webhook.
 */
@Injectable()
export class WhatsappEventsWorker implements OnModuleDestroy {
  private readonly worker: Worker;
  private readonly logger = StructuredLogger.fromEnv();

  constructor(
    @Inject(WHATSAPP_EVENT_REPOSITORY)
    private readonly events: WhatsappEventRepository,
    @Inject(LLM_JOB_QUEUER)
    private readonly llmJobQueuer: LlmJobQueuer,
    private readonly conversations: ConversationsService,
    connectionString: string,
  ) {
    this.worker = new Worker(
      WHATSAPP_EVENTS_QUEUE,
      async (job) => {
        try {
          const { providerEventId } = job.data as { providerEventId: string };
          const event = await this.events.findByProviderEventId(providerEventId);
          if (!event) {
            // El evento se borró o nació fuera de la cola: el ACK evita reintentar
            // algo que no existe.
            this.logger.debug(
              "WhatsApp event not found, skipping",
              "WhatsappEventsWorker",
              { providerEventId, jobId: job.id },
            );
            return;
          }
          if (event.tenantId && event.accountId) {
            const result = await this.conversations.ingestInbound({
              tenantId: event.tenantId,
              accountId: event.accountId,
              payload: event.payload,
            });
            for (const ins of result.inserted) {
              // OJO: el `requestId` viaja como `jobId` de BullMQ (`LlmJobQueue.enqueue`)
              // y BullMQ prohíbe `:` en los ids personalizados ("Custom Id cannot
              // contain :"). Con `wa:<uuid>` el primer intento fallaba, el reintento
              // veía el mensaje como duplicado y la IA jamás se enteraba. Se usa `-`.
              await this.llmJobQueuer.enqueue({
                tenantId: event.tenantId,
                conversationId: ins.conversationId,
                inboundMessageId: ins.messageId,
                requestId: `wa-${ins.messageId}`,
              });
            }
          }
          await this.events.markProcessed(event.id, new Date());
          this.logger.debug(
            "WhatsApp event processed",
            "WhatsappEventsWorker",
            {
              providerEventId,
              jobId: job.id,
            },
          );
        } catch (error) {
          this.logger.error(
            "WhatsApp event processing failed",
            "WhatsappEventsWorker",
            {
              jobId: job.id,
              jobData: job.data,
              attemptsMade: job.attemptsMade,
              error: String(error),
            },
          );
          // Relanzar para que BullMQ reintente
          throw error;
        }
      },
      {
        // Worker con comandos bloqueantes: ioredis necesita
        // `maxRetriesPerRequest: null`, o marca la conexión como fallida tras
        // el primer timeout del BRPOPLPUSH.
        connection: new Redis(connectionString, {
          maxRetriesPerRequest: null,
        }),
        concurrency: 5,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}