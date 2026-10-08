import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { Observable } from "rxjs";
import type { RealtimeEventDto } from "@negocia/contracts";
import { REALTIME_CHANNEL, type RealtimeRedis } from "./redis-client";

const KEEP_ALIVE_MS = 25_000;

/**
 * Suscriptor Redis + fan-out SSE (solo proceso API).
 *
 * Un único suscriptor por instancia de API recibe los eventos del canal y los
 * re-emite en proceso por tenant; cada conexión `@Sse` consume un stream
 * filtrado por su `tenantId`. La suscripción a Redis es perezosa: se abre con
 * la primera conexión SSE, así que en entornos de test sin Redis el módulo
 * arranca igual.
 */
@Injectable()
export class RealtimeServer implements OnModuleDestroy {
  private readonly bus = new EventEmitter();
  private connected = false;

  constructor(private readonly redis: RealtimeRedis) {
    this.redis.on("message", (_channel, message) => {
      const event = parseRealtimeEvent(message);
      if (event) {
        this.bus.emit("event", event);
      }
    });
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.connected = true;
    try {
      await this.redis.subscribe(REALTIME_CHANNEL);
    } catch {
      // Sin Redis disponible: los eventos se pierden, el panel cae al polling.
    }
  }

  stream(tenantId: string): Observable<unknown> {
    return new Observable<Record<string, unknown>>((subscriber) => {
      const onEvent = (event: RealtimeEventDto) => {
        if (event.tenantId !== tenantId) {
          return;
        }
        subscriber.next({
          event: event.event,
          data: JSON.stringify(event),
        });
      };
      this.bus.on("event", onEvent);
      const keepAlive = setInterval(() => {
        subscriber.next({ comment: "keep-alive" });
      }, KEEP_ALIVE_MS);
      return () => {
        clearInterval(keepAlive);
        this.bus.off("event", onEvent);
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // Igual que en el publisher: la conexión pudo no haberse establecido.
    }
  }
}

function parseRealtimeEvent(raw: string): RealtimeEventDto | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RealtimeEventDto>;
    if (
      typeof parsed.event === "string" &&
      typeof parsed.tenantId === "string"
    ) {
      return {
        event: parsed.event,
        tenantId: parsed.tenantId,
        at: parsed.at ?? new Date().toISOString(),
        ...(parsed.conversationId
          ? { conversationId: parsed.conversationId }
          : {}),
        ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
      } as RealtimeEventDto;
    }
    return null;
  } catch {
    return null;
  }
}