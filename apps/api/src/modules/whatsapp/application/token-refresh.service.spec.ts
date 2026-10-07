import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";
import type {
  UpdateWhatsappAccountInput,
  WhatsappAccountRepository,
} from "../../../domain/ports/whatsapp-account-repository";
import { TokenRefreshService } from "./token-refresh.service";

function account(overrides: Partial<WhatsappAccountRecord> = {}): WhatsappAccountRecord {
  return {
    id: "wa-1",
    tenantId: "t-1",
    wabaId: "waba-1",
    phoneNumberId: "pn-1",
    displayPhone: "+56912345678",
    accessToken: "tok-1",
    accessTokenEncrypted: { iv: "iv", ciphertext: "ct", tag: "tag" },
    tokenExpiresAt: new Date(),
    tokenRefreshedAt: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeAccounts implements WhatsappAccountRepository {
  readonly due: WhatsappAccountRecord[] = [];
  readonly updated: UpdateWhatsappAccountInput[] = [];
  readonly expired: string[] = [];

  async findExpiringBefore(): Promise<WhatsappAccountRecord[]> {
    return this.due;
  }
  async updateAccessToken(input: UpdateWhatsappAccountInput): Promise<WhatsappAccountRecord> {
    this.updated.push(input);
    return account({ id: input.id, accessToken: input.accessToken });
  }
  async markTokenExpired(id: string): Promise<void> {
    this.expired.push(id);
  }
  async findById(): Promise<WhatsappAccountRecord | null> {
    return null;
  }
  async findByPhoneNumberId(): Promise<WhatsappAccountRecord | null> {
    return null;
  }
  async listByTenant(): Promise<WhatsappAccountRecord[]> {
    return [];
  }
  async create(): Promise<WhatsappAccountRecord> {
    throw new Error("not used in these tests");
  }
}

function config(driver: "mock" | "real" = "real") {
  const values: Record<string, unknown> = {
    META_DRIVER: driver,
    META_APP_ID: "app-1",
    META_APP_SECRET: "secret-1",
    META_EMBEDDED_SIGNUP_REDIRECT_URI: "https://cb.test",
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<ApiEnv, true>;
}

/** fetch que renueva tok-1 y revienta tok-muerto con 190 (token vencido). */
function exchangeFetch() {
  return vi.fn(async (input: string) => {
    if (input.includes("fb_exchange_token=tok-muerto")) {
      return new Response(
        JSON.stringify({ error: { code: 190, message: "Expired token" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        access_token: "tok-nuevo",
        token_type: "bearer",
        expires_in: 60 * 24 * 60 * 60,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokenRefreshService.refreshDueAccounts", () => {
  it("es no-op con META_DRIVER=mock (no toca Meta ni BD)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const accounts = new FakeAccounts();
    accounts.due.push(account());
    const service = new TokenRefreshService(config("mock"), accounts);

    const outcome = await service.refreshDueAccounts();

    expect(outcome).toEqual({ refreshed: 0, skipped: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(accounts.updated).toHaveLength(0);
  });

  it("renueva por fb_exchange_token y guarda el nuevo vencimiento", async () => {
    vi.stubGlobal("fetch", exchangeFetch());
    const accounts = new FakeAccounts();
    accounts.due.push(account());
    const service = new TokenRefreshService(config("real"), accounts);

    const outcome = await service.refreshDueAccounts();

    expect(outcome.refreshed).toBe(1);
    expect(accounts.updated).toHaveLength(1);
    const update = accounts.updated[0]!;
    expect(update.id).toBe("wa-1");
    expect(update.accessToken).toBe("tok-nuevo");
    expect(update.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(accounts.expired).toHaveLength(0);
  });

  it("marca TOKEN_EXPIRED cuando el token ya venció y sigue con el resto", async () => {
    vi.stubGlobal("fetch", exchangeFetch());
    const accounts = new FakeAccounts();
    accounts.due.push(
      account({ id: "wa-muerta", accessToken: "tok-muerto" }),
      account({ id: "wa-sana", accessToken: "tok-1" }),
    );
    const service = new TokenRefreshService(config("real"), accounts);

    const outcome = await service.refreshDueAccounts();

    expect(outcome.failed).toBe(1);
    expect(outcome.refreshed).toBe(1);
    expect(accounts.expired).toEqual(["wa-muerta"]);
    expect(accounts.updated.map((u) => u.id)).toEqual(["wa-sana"]);
  });

  it("un fallo del provider no marca nada (se loguea y sigue)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 11, message: "server error" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const accounts = new FakeAccounts();
    accounts.due.push(account());
    const service = new TokenRefreshService(config("real"), accounts);

    const outcome = await service.refreshDueAccounts();

    expect(outcome.failed).toBe(1);
    expect(accounts.expired).toHaveLength(0);
    expect(accounts.updated).toHaveLength(0);
  });
});