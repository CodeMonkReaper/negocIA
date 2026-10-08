import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { RealtimeEventDto } from "@negocia/contracts";
import type { EventPublisher, PublishEventInput } from "../../domain/ports/event-publisher";
import { REALTIME_CHANNEL, type RealtimeRedis } from "./redis-client";

/**
 * Publica eventos realtime en Redis (`negocia:realtime`).
 *
 * Best-effort por diseño: si Redis está caído el publish se descarta en
 * silencio para no interrumpir el flujo de negocio; el panel se apoya en su
 * polling de respaldo.
 */
@Injectable()
export class RealtimePublisher implements EventPublisher, OnModuleDestroy {
  constructor(private readonly redis: RealtimeRedis) {}

  async publish(input: PublishEventInput): Promise<void> {
    const payload: RealtimeEventDto = {
      event: input.event,
      tenantId: input.tenantId,
      at: new Date().toISOString(),
    };
    if (input.conversationId) {
      payload.conversationId = input.conversationId;
    }
    if (input.accountId) {
      payload.accountId = input.accountId;
    }
    try {
      await this.redis.publish(REALTIME_CHANNEL, JSON.stringify(payload));
    } catch {
      // Best-effort: nada que propagar al flujo de negocio.
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // La conexión pudo nunca haberse establecido.
    }
  }
}