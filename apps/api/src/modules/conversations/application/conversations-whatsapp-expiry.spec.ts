import { describe, expect, it, vi } from "vitest";
import { ExternalProviderError, WhatsAppTokenExpiredError } from "../../../domain/errors";
import type { ConversationRepository } from "../../../domain/ports/conversation-repository";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";
import type { WhatsappAccountRepository } from "../../../domain/ports";
import type { WhatsappProvider } from "../../../domain/ports/whatsapp-provider";
import type { LlmRunRepository } from "../../../domain/ports/llm-run-repository";
import { ConversationsService } from "./conversations.service";

const CONVERSATION = {
  id: "c1",
  tenantId: "t1",
  accountId: "wa-1",
  customerWaId: "+56912345678",
} as const;

class FakeConversations {
  readonly recorded: unknown[] = [];

  async findById(tenantId: string): Promise<typeof CONVERSATION | null> {
    return tenantId === "t1" ? { ...CONVERSATION } : null;
  }

  async listByTenant() {
    return { items: [], total: 0 };
  }

  async listMessages() {
    return { items: [], total: 0 };
  }

  async recordOutboundMessage(
    _where: unknown,
    message: { providerMessageId?: string; content?: string },
  ) {
    this.recorded.push(message);
    return { id: "m-1", content: message.content ?? "" };
  }
}

class FakeAccounts implements WhatsappAccountRepository {
  readonly marked: string[] = [];
  private readonly account: WhatsappAccountRecord = {
    id: "wa-1",
    tenantId: "t1",
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
  };

  async findById(tenantId: string, id: string): Promise<WhatsappAccountRecord | null> {
    return tenantId === "t1" && id === this.account.id ? this.account : null;
  }

  async findByPhoneNumberId(): Promise<WhatsappAccountRecord | null> {
    return null;
  }

  async listByTenant(): Promise<WhatsappAccountRecord[]> {
    return [];
  }

  async findExpiringBefore(): Promise<WhatsappAccountRecord[]> {
    return [];
  }

  async create(): Promise<WhatsappAccountRecord> {
    throw new Error("not used");
  }

  async updateAccessToken(): Promise<WhatsappAccountRecord> {
    throw new Error("not used");
  }

  async markTokenExpired(id: string): Promise<void> {
    this.marked.push(id);
  }
}

function provider(behavior: () => Promise<unknown>) {
  return {
    sendTextMessage: vi.fn(behavior),
  } as unknown as WhatsappProvider;
}

function service(wa: WhatsappProvider) {
  const conversations = new FakeConversations();
  const accounts = new FakeAccounts();
  const runs = {} as unknown as LlmRunRepository;
  return {
    accounts,
    service: new ConversationsService(
      conversations as unknown as ConversationRepository,
      accounts,
      wa,
      runs,
    ),
  };
}

describe("ConversationsService.sendMessage con token vencido", () => {
  it("marca la cuenta TOKEN_EXPIRED y relanza el error", async () => {
    const wa = provider(async () => {
      throw new WhatsAppTokenExpiredError("Session has expired", { code: 190 });
    });
    const { accounts, service: svc } = service(wa);

    const error = await svc
      .sendMessage({
        tenantId: "t1",
        conversationId: "c1",
        text: "Hola",
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(WhatsAppTokenExpiredError);
    expect(accounts.marked).toEqual(["wa-1"]);
  });

  it("no marca la cuenta ante un error no relacionado con el token", async () => {
    const wa = provider(async () => {
      throw new ExternalProviderError("Message undeliverable", { code: 131030 });
    });
    const { accounts, service: svc } = service(wa);

    await svc
      .sendMessage({ tenantId: "t1", conversationId: "c1", text: "Hola" })
      .catch(() => undefined);

    expect(accounts.marked).toHaveLength(0);
  });

  it("persiste el mensaje si Meta acepta", async () => {
    const wa = provider(async () => ({ providerMessageId: "wamid.ok" }));
    const { service: svc } = service(wa);

    const message = await svc.sendMessage({
      tenantId: "t1",
      conversationId: "c1",
      text: "Hola",
    });

    expect(message.id).toBe("m-1");
  });
});