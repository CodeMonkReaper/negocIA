import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { EVENT_PUBLISHER } from "../../common/di-tokens";
import { createRealtimeRedis } from "./redis-client";
import { RealtimePublisher } from "./realtime-publisher";

/**
 * Módulo global del publicador realtime.
 *
 * Se importa en `AppModule` (API) y en `WorkerModule`: ambos procesos publican
 * eventos (mensajes entrantes, runs) que el API re-emite por SSE al panel.
 * El suscriptor/fan-out SSE vive aparte (ver `RealtimeSseModule`), solo en API.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: EVENT_PUBLISHER,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new RealtimePublisher(
          createRealtimeRedis(config.get("REDIS_URL", { infer: true })),
        ),
      inject: [ConfigService],
    },
  ],
  exports: [EVENT_PUBLISHER],
})
export class RealtimeModule {}