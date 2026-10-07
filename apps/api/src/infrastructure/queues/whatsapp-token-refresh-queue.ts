import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const WHATSAPP_TOKEN_REFRESH_QUEUE = "whatsapp-token-refresh";
export const TOKEN_REFRESH_JOB_NAME = "refresh-due";
/** Id del JobScheduler repeatable (upsert: idempotente). */
export const TOKEN_REFRESH_SCHEDULER_ID = "whatsapp-token-refresh-daily";

/** Cada 24 h: el scan interno de `refreshDueAccounts` decide qué renovar. */
export const TOKEN_REFRESH_REPEAT_MS = 24 * 60 * 60 * 1_000;

/**
 * Cola BullMQ del refresh de tokens de WhatsApp (M8.2).
 *
 * A diferencia de `whatsapp-events`, aquí el **productor** es un JobScheduler
 * repeatable (uno cada `TOKEN_REFRESH_REPEAT_MS`) creado en el worker: es el
 * proceso que vive para renovar, y hasta que no se despliega worker no tiene
 * sentido encolar nada. BullMQ guarda el scheduler en Redis, así que un
 * reinicio del worker re-genera el tick con `upsert` (sin duplicar).
 */
@Injectable()
export class BullWhatsappTokenRefreshQueue implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(connectionString: string) {
    this.queue = new Queue(WHATSAPP_TOKEN_REFRESH_QUEUE, {
      connection: new Redis(connectionString, {
        maxRetriesPerRequest: null,
        connectTimeout: 1_000,
        commandTimeout: 1_000,
      }),
    });
  }

  /** Registra/actualiza el tick diario (idempotente). Errores: solo log. */
  async ensureScheduler(): Promise<void> {
    await this.queue.upsertJobScheduler(
      TOKEN_REFRESH_SCHEDULER_ID,
      { every: TOKEN_REFRESH_REPEAT_MS },
      { name: TOKEN_REFRESH_JOB_NAME, data: {} },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}