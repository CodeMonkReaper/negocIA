import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppTokenExpiredError } from "../../domain/errors";
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  MetaOAuthClient,
} from "./meta-oauth";

const BASE_URL = "https://graph.test";

function fakeFetch(body: unknown, init: { status?: number } = {}) {
  return vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function client() {
  return new MetaOAuthClient("app-1", "secret-1", "https://cb.test", BASE_URL);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MetaOAuthClient.exchangeCodeForToken", () => {
  it("mapea el code a token y usa el expires_in de Meta", async () => {
    const fetchMock = fakeFetch({
      access_token: "tok-1",
      token_type: "bearer",
      expires_in: 3600,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().exchangeCodeForToken("code-abc");

    expect(result).toEqual({ accessToken: "tok-1", expiresIn: 3600 });
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).toContain(BASE_URL);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-abc");
  });

  it("asume 60 días si Meta no devuelve expires_in", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ access_token: "tok-1", token_type: "bearer" }),
    );

    const result = await client().exchangeCodeForToken("code-abc");

    expect(result.expiresIn).toBe(DEFAULT_TOKEN_TTL_SECONDS);
  });
});

describe("MetaOAuthClient.exchangeLongLivedToken", () => {
  it("renueva con fb_exchange_token y devuelve el nuevo vencimiento", async () => {
    const fetchMock = fakeFetch({
      access_token: "tok-2",
      token_type: "bearer",
      expires_in: 60 * 24 * 60 * 60,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().exchangeLongLivedToken("tok-1");

    expect(result).toEqual({
      accessToken: "tok-2",
      expiresIn: 60 * 24 * 60 * 60,
    });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("fb_exchange_token")).toBe("tok-1");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("client_secret")).toBe("secret-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://cb.test");
  });

  it("rechaza un token que ya venció (401) con WhatsAppTokenExpiredError", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        { error: { code: 190, message: "Expired token" } },
        { status: 401 },
      ),
    );

    const error = await client().exchangeLongLivedToken("tok-muerto").catch((e) => e);

    expect(error).toBeInstanceOf(WhatsAppTokenExpiredError);
    expect((error as WhatsAppTokenExpiredError).tokenExpired).toBe(true);
    expect((error as WhatsAppTokenExpiredError).status).toBe(502);
  });

  it("detecta code 190 aunque el status HTTP no sea 401", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        error: { code: 190, message: "Session has expired" },
      }),
    );

    const error = await client().exchangeLongLivedToken("tok-1").catch((e) => e);

    expect(error).toBeInstanceOf(WhatsAppTokenExpiredError);
  });
});