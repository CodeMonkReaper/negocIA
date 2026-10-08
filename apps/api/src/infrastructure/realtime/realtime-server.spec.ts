import { describe, expect, it, vi } from "vitest";
import { RealtimeServer } from "./realtime-server";
import type { RealtimeRedis } from "./redis-client";

interface FakeListener {
  on: ReturnType<typeof vi.fn>;
  triggered(channel: string, message: string): void;
}

function fakeRedis(): RealtimeRedis & FakeListener {
  let listener: ((channel: string, message: string) => void) | null = null;
  const redis = {
    on: vi.fn((event: string, cb: (channel: string, message: string) => void) => {
      if (event === "message") listener = cb;
    }),
    subscribe: vi.fn().mockResolvedValue([] as string[]),
    quit: vi.fn().mockResolvedValue("OK" as const),
  };
  return {
    ...(redis as unknown as RealtimeRedis),
    on: redis.on,
    subscribe: redis.subscribe,
    quit: redis.quit,
    triggered(channel, message) {
      listener?.(channel, message);
    },
  };
}

describe("RealtimeServer.stream", () => {
  it("emite solo eventos del tenant suscrito, gzip con data", () => {
    const redis = fakeRedis();
    const server = new RealtimeServer(redis);

    const received: unknown[] = [];
    const subscription = server.stream("t-1").subscribe((payload) => {
      received.push(payload);
    });

    const mine = {
      event: "conversation.changed",
      tenantId: "t-1",
      conversationId: "conv-1",
      at: "2026-01-01T00:00:00.000Z",
    };
    redis.triggered("negocia:realtime", JSON.stringify(mine));
    redis.triggered("negocia:realtime", JSON.stringify({ ...mine, tenantId: "t-2" }));

    expect(received).toHaveLength(1);
    const payload = received[0] as { event: string; data: string };
    expect(payload.event).toBe("conversation.changed");
    expect(JSON.parse(payload.data)).toEqual(mine);

    subscription.unsubscribe();
  });

  it("ignora mensajes malformados y suscribe el canal una sola vez", async () => {
    const redis = fakeRedis();
    const server = new RealtimeServer(redis);

    const received: unknown[] = [];
    const subscription = server.stream("t-1").subscribe((payload) => {
      received.push(payload);
    });
    void server.connect();
    void server.connect();

    redis.triggered("negocia:realtime", "no-json{");

    expect(received).toHaveLength(0);
    expect(redis.subscribe).toHaveBeenCalledTimes(1);
    expect(redis.subscribe).toHaveBeenCalledWith("negocia:realtime");

    subscription.unsubscribe();
    await server.onModuleDestroy();
  });
});