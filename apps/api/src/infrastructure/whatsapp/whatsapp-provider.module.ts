import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { WHATSAPP_PROVIDER } from "../../common/di-tokens";
import { createWhatsappProvider } from "./whatsapp-provider.factory";

@Module({
  providers: [
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService<ApiEnv, true>) => createWhatsappProvider(config),
      inject: [ConfigService],
    },
  ],
  exports: [WHATSAPP_PROVIDER],
})
export class WhatsappProviderModule {}
