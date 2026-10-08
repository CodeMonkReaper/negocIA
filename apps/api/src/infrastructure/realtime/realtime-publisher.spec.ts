import { describe, expect, it, vi } from "vitest";
import { RealtimePublisher } from "./realtime-publisher";
import { REALTIME_CHANNEL, type RealtimeRedis } from "./redis-client";

function fakeRedis(overrides: Partial<RealtimeRedis> = {}): RealtimeRedis {
  return {
    on: vi.fn(),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue([]),
    quit: vi.fn().mockResolvedValue("OK"),
    ...overrides,
  } as unknown as RealtimeRedis;
}

describe("RealtimePublisher", () => {
  it("publica en el canal un JSON con event, tenantId, at y conversationId", async () => {
    const redis = fakeRedis();
    const publisher = new RealtimePublisher(redis);
    const publish = redis.publish as ReturnType<typeof vi.fn>;

    await publisher.publish({
      event: "conversation.changed",
      tenantId: "t-1",
      conversationId: "conv-1",
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, raw] = publish.mock.calls[0] as [string, string];
    expect(channel).toBe(REALTIME_CHANNEL);
    const parsed = JSON.parse(raw) as {
      event: string;
      tenantId: string;
      conversationId?: string;
      at: string;
    };
    expect(parsed.event).toBe("conversation.changed");
    expect(parsed.tenantId).toBe("t-1");
    expect(parsed.conversationId).toBe("conv-1");
    expect(typeof parsed.at).toBe("string");
  });

  it("no propaga un fallo de Redis (best-effort)", async () => {
    const redis = fakeRedis({
      publish: vi.fn().mockRejectedValue(new Error("redis caído")),
    });
    const publisher = new RealtimePublisher(redis);

    await expect(
      publisher.publish({ event: "account.changed", tenantId: "t-1" }),
    ).resolves.toBeUndefined();
  });
});