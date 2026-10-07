import { describe, expect, it } from "vitest";
import { MockEmailAdapter } from "./email-sender.mock";
import type { EmailMessage } from "../domain/ports";

describe("MockEmailAdapter", () => {
  it("registra el mensaje enviado", async () => {
    const adapter = new MockEmailAdapter();
    const message: EmailMessage = {
      to: "user@example.com",
      template: "verification",
      data: { name: "Ana" },
      token: "opaque-1",
    };

    await adapter.send(message);

    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]).toEqual(message);
  });

  it("acumula múltiples envíos y no comparte estado entre instancias", async () => {
    const a = new MockEmailAdapter();
    const b = new MockEmailAdapter();

    await a.send({ to: "a@example.com", template: "invitation", data: {} });

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(0);
  });
});