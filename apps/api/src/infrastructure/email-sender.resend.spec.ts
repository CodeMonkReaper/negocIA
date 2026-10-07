import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "../domain/ports";
import {
  ResendEmailAdapter,
  type ResendClientLike,
  type ResendEmailAdapterOptions,
  type ResendEmailPayload,
} from "./email-sender.resend";

function options(overrides: Partial<ResendEmailAdapterOptions> = {}) {
  return {
    apiKey: "re_test",
    from: "no-reply@negocia.app",
    fromName: "negocIA",
    baseUrl: "https://app.negocia.com",
    ...overrides,
  };
}

describe("ResendEmailAdapter", () => {
  function fakeClient() {
    const send = vi.fn<(payload: ResendEmailPayload) => Promise<unknown>>(
      async () => ({ data: { id: "msg_1" } }),
    );
    const client: ResendClientLike = { emails: { send } };
    return { client, send };
  }

  const logger = { warn: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    logger.warn.mockClear();
  });

  it("compone from, asunto y cuerpo de verificación con el token en el enlace", async () => {
    const { client, send } = fakeClient();
    const adapter = new ResendEmailAdapter(client, options({ logger }));
    const message: EmailMessage = {
      to: "ana@example.com",
      template: "verification",
      data: { name: "Ana Torres", tenantName: "La Panadería" },
      token: "tok-abc",
      expiresAt: new Date("2026-10-05T12:00:00.000Z"),
    };

    await adapter.send(message);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0];
    expect(payload.from).toBe("negocIA <no-reply@negocia.app>");
    expect(payload.to).toBe("ana@example.com");
    expect(payload.subject).toBe("Confirma tu correo en negocIA");
    expect(payload.text).toContain("Hola Ana Torres,");
    expect(payload.text).toContain("La Panadería");
    expect(payload.text).toContain(
      "https://app.negocia.com/verificar-email?token=tok-abc",
    );
    expect(payload.text).toContain("caduca el 5 de octubre de 2026");
    expect(payload.html).toContain("Abrir enlace");
  });

  it("escapa datos de usuario en el HTML", async () => {
    const { client, send } = fakeClient();
    const adapter = new ResendEmailAdapter(client, options({ logger }));

    await adapter.send({
      to: "ana@example.com",
      template: "invitation",
      data: { tenantName: "<script>alert(1)</script>", role: "AGENT" },
      token: "tok-x",
      expiresAt: new Date(),
    });

    const html = send.mock.calls[0]![0].html;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("incluye rol y tenant en la plantilla de invitación", async () => {
    const { client, send } = fakeClient();
    const adapter = new ResendEmailAdapter(client, options({ logger }));

    await adapter.send({
      to: "invitado@example.com",
      template: "invitation",
      data: { tenantName: "La Panadería", role: "AGENT" },
      token: "tok-i",
      expiresAt: new Date(),
    });

    const text = send.mock.calls[0]![0].text;
    expect(send.mock.calls[0]![0].subject).toBe(
      "Te invitaron a un espacio en negocIA",
    );
    expect(text).toContain("como AGENT");
    expect(text).toContain("al espacio La Panadería");
    expect(text).toContain("/invitacion?token=tok-i");
  });

  it("usa la plantilla de reset con su ruta y asunto", async () => {
    const { client, send } = fakeClient();
    const adapter = new ResendEmailAdapter(client, options({ logger }));

    await adapter.send({
      to: "ana@example.com",
      template: "reset-password",
      data: { name: "Ana" },
      token: "tok-r",
      expiresAt: new Date(),
    });

    const payload = send.mock.calls[0]![0];
    expect(payload.subject).toBe("Restablece tu contraseña de negocIA");
    expect(payload.text).toContain("/restablecer-password?token=tok-r");
    expect(payload.html).toContain("Solicitamos restablecer");
  });

  it("no propaga el fallo del proveedor y registra un warn", async () => {
    const send = vi.fn(async () => {
      throw new Error("rate limit");
    });
    const client: ResendClientLike = { emails: { send } };
    const adapter = new ResendEmailAdapter(client, options({ logger }));

    await expect(
      adapter.send({
        to: "ana@example.com",
        template: "verification",
        data: { name: "Ana" },
        token: "tok-f",
        expiresAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});