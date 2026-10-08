import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { createRealtimeRedis } from "./redis-client";
import { RealtimeEventsController } from "./realtime-events.controller";
import { RealtimeServer } from "./realtime-server";

/**
 * Módulo SSE (solo proceso API). El suscriptor Redis + fan-out y el endpoint
 * `@Sse` no tienen sentido en el worker, así que se importa únicamente en
 * `AppModule`.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RealtimeServer,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new RealtimeServer(
          createRealtimeRedis(config.get("REDIS_URL", { infer: true })),
        ),
      inject: [ConfigService],
    },
  ],
  controllers: [RealtimeEventsController],
})
export class RealtimeSseModule {}