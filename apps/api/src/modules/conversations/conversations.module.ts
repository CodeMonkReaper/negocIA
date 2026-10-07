import { Module } from "@nestjs/common";


import { ConversationsService } from "./application/conversations.service";
import { ConversationsController } from "./presentation/conversations.controller";
import { WhatsappProviderModule } from "../../infrastructure/whatsapp/whatsapp-provider.module";

/**
 * Conversaciones y mensajes del canal (F2-4 / M8).
 *
 * El repositorio de conversaciones y el de cuentas llegan de `DatabaseModule`
 * (global). `WHATSAPP_PROVIDER` se provee desde `WhatsappProviderModule`.
 * El mismo `ConversationsService` lo usa el worker (`worker.module.ts`) para
 * ingestar mensajes entrantes.
 */
@Module({
  imports: [WhatsappProviderModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}