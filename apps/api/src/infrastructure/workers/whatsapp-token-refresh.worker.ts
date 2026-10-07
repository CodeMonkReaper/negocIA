import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { StructuredLogger } from "../../common/logger/structured-logger";
import { TokenRefreshService } from "../../modules/whatsapp/application/token-refresh.service";
import {
  BullWhatsappTokenRefreshQueue,
  TOKEN_REFRESH_JOB_NAME,
  WHATSAPP_TOKEN_REFRESH_QUEUE,
} from "../queues/whatsapp-token-refresh-queue";

/**
 * Worker de renovación de tokens de WhatsApp (M8.2).
 *
 * Proceso separado (igual que `whatsapp-events`): consume el tick diario,
 * `refreshDueAccounts` decide qué cuentas renovar con `fb_exchange_token`.
 *
 * El JobScheduler repeatable se registra aquí (ver `BullWhatsappTokenRefreshQueue`);
 * el job en sí no lleva datos: el estado lo lee el service de BD.
 */
@Injectable()
export class WhatsappTokenRefreshWorker implements OnModuleDestroy {
  private readonly worker: Worker;
  private readonly scheduler: BullWhatsappTokenRefreshQueue;
  private readonly logger = StructuredLogger.fromEnv();

  constructor(
    private readonly refresh: TokenRefreshService,
    connectionString: string,
  ) {
    this.scheduler = new BullWhatsappTokenRefreshQueue(connectionString);
    // El tick diario se (re)crea al arrancar el worker; si Redis no está aún
    // listo, se reintenta con el próximo job manual o reinicio (upsert).
    void this.scheduler.ensureScheduler().catch((error) => {
      this.logger.error(
        "Failed to register WhatsApp token refresh scheduler",
        "WhatsappTokenRefreshWorker",
        { error: String(error) },
      );
    });

    this.worker = new Worker(
      WHATSAPP_TOKEN_REFRESH_QUEUE,
      async (job) => {
        if (job.name !== TOKEN_REFRESH_JOB_NAME) {
          return;
        }
        this.logger.debug(
          "WhatsApp token refresh tick",
          "WhatsappTokenRefreshWorker",
          { jobId: job.id },
        );
        const outcome = await this.refresh.refreshDueAccounts();
        this.logger.debug(
          "WhatsApp token refresh tick done",
          "WhatsappTokenRefreshWorker",
          {
            jobId: job.id,
            refreshed: outcome.refreshed,
            skipped: outcome.skipped,
            failed: outcome.failed,
          },
        );
        return outcome;
      },
      {
        connection: new Redis(connectionString, {
          maxRetriesPerRequest: null,
        }),
        concurrency: 1,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.scheduler.onModuleDestroy();
  }
}