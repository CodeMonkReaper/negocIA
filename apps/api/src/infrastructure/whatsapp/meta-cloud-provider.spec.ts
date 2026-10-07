import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExternalProviderError,
  WhatsAppTokenExpiredError,
  type AppError,
} from "../../domain/errors";
import { MetaCloudProvider } from "./meta-cloud-provider";

function fakeFetch(body: unknown, init: { status?: number } = {}) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function provider() {
  return new MetaCloudProvider();
}

function sendInput() {
  return {
    phoneNumberId: "pn-1",
    accessToken: "tok-1",
    to: "56912345678",
    text: "Hola",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MetaCloudProvider", () => {
  it("devuelve el id del mensaje enviado", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        messaging_product: "whatsapp",
        messages: [{ id: "wamid.HBg1" }],
      }),
    );

    const result = await provider().sendTextMessage(sendInput());

    expect(result).toEqual({ providerMessageId: "wamid.HBg1" });
  });

  it("traduce error 190 de Graph a WhatsAppTokenExpiredError", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        {
          error: { code: 190, error_subcode: 464, message: "Session has expired" },
        },
        { status: 400 },
      ),
    );

    const error = await provider()
      .sendTextMessage(sendInput())
      .catch((e) => e);

    expect(error).toBeInstanceOf(WhatsAppTokenExpiredError);
    expect((error as WhatsAppTokenExpiredError).tokenExpired).toBe(true);
    expect((error as WhatsAppTokenExpiredError).status).toBe(502);
    expect((error as AppError).code).toBe("external_provider_error");
  });

  it("trata el 401 HTTP como token vencido", async () => {
    vi.stubGlobal("fetch", fakeFetch({ error: { message: "unauthorized" } }, { status: 401 }));

    const error = await provider()
      .sendTextMessage(sendInput())
      .catch((e) => e);

    expect(error).toBeInstanceOf(WhatsAppTokenExpiredError);
  });

  it("deja intactos los demás errores de Meta (ExternalProviderError)", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        { error: { code: 131030, message: "Message undeliverable" } },
        { status: 400 },
      ),
    );

    const error = await provider()
      .sendTextMessage(sendInput())
      .catch((e) => e);

    expect(error).toBeInstanceOf(ExternalProviderError);
    expect(error).not.toBeInstanceOf(WhatsAppTokenExpiredError);
  });
});