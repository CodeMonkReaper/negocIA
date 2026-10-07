import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import {
  WHATSAPP_EVENT_QUEUER,
  WHATSAPP_WEBHOOK_LOGGER,
} from "../../common/di-tokens";
import { StructuredLogger } from "../../common/logger/structured-logger";
import { BullWhatsappEventQueue } from "../../infrastructure/queues/whatsapp-event-queue";
import { WhatsAppWebhookService } from "./application/whatsapp-webhook.service";
import { WhatsappAccountsService } from "./application/whatsapp-accounts.service";
import { EmbeddedSignupService } from "./application/embedded-signup.service";
import { WhatsappAccountsController } from "./presentation/whatsapp-accounts.controller";
import { WhatsAppWebhookController } from "./presentation/whatsapp-webhook.controller";

/**
 * Composition root del canal Meta WhatsApp (F2-3/M8).
 *
 * Los repositorios (`WHATSAPP_ACCOUNT_REPOSITORY`, `WHATSAPP_EVENT_REPOSITORY`)
 * llegan de `DatabaseModule` (global). Aquí se cierra el webhook contra su cola
 * (`BullWhatsappEventQueue`; el worker es un proceso aparte que abre la cola
 * por su lado) y se le da al service un logger inyectable para los tests.
 */
@Module({
  controllers: [WhatsAppWebhookController, WhatsappAccountsController],
  providers: [
    WhatsAppWebhookService,
    WhatsappAccountsService,
    EmbeddedSignupService,
    { provide: WHATSAPP_WEBHOOK_LOGGER, useValue: StructuredLogger.fromEnv() },
    {
      provide: BullWhatsappEventQueue,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new BullWhatsappEventQueue(config.get("REDIS_URL", { infer: true })),
      inject: [ConfigService],
    },
    { provide: WHATSAPP_EVENT_QUEUER, useExisting: BullWhatsappEventQueue },
  ],
  exports: [WHATSAPP_EVENT_QUEUER, BullWhatsappEventQueue, EmbeddedSignupService],
})
export class WhatsappModule {}