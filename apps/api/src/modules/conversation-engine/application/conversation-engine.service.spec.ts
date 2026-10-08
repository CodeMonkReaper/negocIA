import { describe, expect, it } from "vitest";
import { ConversationEngineService } from "./conversation-engine.service";
import type { ToolExecutor } from "./tool-executor";
import type { TenantContextService } from "../../../common/tenant-context/tenant-context.service";
import type {
  ConversationRecord,
  MessageRecord,
  OutboundMessageDraft,
} from "../../../domain/conversations/entities";
import type {
  CompleteLlmRunDraft,
  LlmRunRecord,
} from "../../../domain/llm/entities";
import type { ConversationRepository } from "../../../domain/ports/conversation-repository";
import type { LlmJobInput } from "../../../domain/ports/llm-job-queuer";
import type {
  LlmCompletion,
  LlmProvider,
} from "../../../domain/ports/llm-provider";
import type { LlmRunRepository } from "../../../domain/ports/llm-run-repository";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappProvider } from "../../../domain/ports/whatsapp-provider";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";

function unusedCall(name: string): never {
  throw new Error(`llamada inesperada al stub: ${name}`);
}

const CONVERSATION: ConversationRecord = {
  id: "conv-1",
  tenantId: "t-1",
  accountId: "acc-1",
  customerWaId: "15550001111",
  customerName: null,
  status: "BOT_ACTIVE",
  lastMessageAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const ACCOUNT: WhatsappAccountRecord = {
  id: "acc-1",
  tenantId: "t-1",
  wabaId: "waba-1",
  phoneNumberId: "pn-1",
  displayPhone: null,
  accessToken: "token-waba",
  accessTokenEncrypted: { iv: "", ciphertext: "", tag: "" },
  tokenExpiresAt: null,
  tokenRefreshedAt: null,
  status: "ACTIVE",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const JOB: LlmJobInput = {
  tenantId: "t-1",
  conversationId: "conv-1",
  inboundMessageId: "in-1",
  requestId: "req-1",
};

function runRecord(): LlmRunRecord {
  return {
    id: "run-1",
    tenantId: "t-1",
    conversationId: "conv-1",
    inboundMessageId: "in-1",
    outboundMessageId: null,
    requestId: "req-1",
    status: "RUNNING",
    driver: "llm",
    requestedModel: "openrouter",
    resolvedModel: null,
    finishReason: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
    attempts: 1,
    latencyMs: null,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function completion(text: string): LlmCompletion {
  return {
    text,
    toolCalls: [],
    finishReason: "stop",
    model: "openrouter/test-model",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

class ConversationStub implements ConversationRepository {
  readonly outbound: OutboundMessageDraft[] = [];

  async findById() {
    return unusedCall("findById");
  }

  async listByTenant() {
    return unusedCall("listByTenant");
  }

  async recordInboundMessage() {
    return unusedCall("recordInboundMessage");
  }

  async recordDeliveryStatus() {
    return unusedCall("recordDeliveryStatus");
  }

  async recordOutboundMessage(
    _scope: { tenantId: string; conversationId: string },
    draft: OutboundMessageDraft,
  ): Promise<MessageRecord> {
    this.outbound.push(draft);
    return {
      id: `msg-${this.outbound.length}`,
      tenantId: "t-1",
      conversationId: "conv-1",
      providerMessageId: draft.providerMessageId,
      direction: "OUTBOUND",
      type: draft.type ?? "text",
      content: draft.content,
      deliveryStatus: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getConversation(): Promise<ConversationRecord> {
    return CONVERSATION;
  }

  async updateStatus() {
    return unusedCall("updateStatus");
  }

  async listRecentMessages(): Promise<MessageRecord[]> {
    return [];
  }

  async listMessages() {
    return unusedCall("listMessages");
  }
}

class LlmStub implements LlmProvider {
  calls = 0;

  constructor(private readonly reply: string) {}

  async complete(): Promise<LlmCompletion> {
    this.calls++;
    return completion(this.reply);
  }
}

class AccountStub implements WhatsappAccountRepository {
  async findByPhoneNumberId() {
    return unusedCall("findByPhoneNumberId");
  }

  async findById(): Promise<WhatsappAccountRecord> {
    return ACCOUNT;
  }

  async listByTenant() {
    return unusedCall("listByTenant");
  }

  async create() {
    return unusedCall("create");
  }

  async updateAccessToken() {
    return unusedCall("updateAccessToken");
  }

  async findExpiringBefore() {
    return unusedCall("findExpiringBefore");
  }

  async markTokenExpired() {
    return unusedCall("markTokenExpired");
  }
}

class WhatsappStub implements WhatsappProvider {
  readonly sent: string[] = [];

  constructor(
    private readonly sendError: Error | null = null,
    /** Solo para ejercer el fallback runtime `pending:`; el tipo exige string. */
    private readonly providerMessageId: string | undefined,
  ) {}

  async sendTextMessage(input: { to: string; text: string }) {
    if (this.sendError) throw this.sendError;
    this.sent.push(`${input.to}:${input.text}`);
    return {
      providerMessageId: this.providerMessageId as string,
    };
  }
}

class RunStub implements LlmRunRepository {
  readonly succeeded: CompleteLlmRunDraft[] = [];
  readonly failed: CompleteLlmRunDraft[] = [];
  skipped = 0;

  constructor(private readonly duplicated = false) {}

  async start(): Promise<LlmRunRecord | "duplicated"> {
    return this.duplicated ? "duplicated" : runRecord();
  }

  async findByRequestId() {
    return unusedCall("findByRequestId");
  }

  async markSucceeded(
    _tenantId: string,
    _requestId: string,
    draft: CompleteLlmRunDraft,
  ): Promise<LlmRunRecord | null> {
    this.succeeded.push(draft);
    return null;
  }

  async markFailed(
    _tenantId: string,
    _requestId: string,
    draft: CompleteLlmRunDraft,
  ): Promise<LlmRunRecord | null> {
    this.failed.push(draft);
    return null;
  }

  async markSkipped(): Promise<LlmRunRecord | null> {
    this.skipped++;
    return null;
  }

  async listByConversation() {
    return unusedCall("listByConversation");
  }
}

function setup(options?: {
  reply?: string;
  sendError?: Error;
  providerMessageId?: string;
  duplicatedRun?: boolean;
}) {
  const conv = new ConversationStub();
  const llm = new LlmStub(options?.reply ?? "Hola");
  const accounts = new AccountStub();
  const wa = new WhatsappStub(
    options?.sendError ?? null,
    options && "providerMessageId" in options
      ? options.providerMessageId
      : "wamid.HBg1",
  );
  const runs = new RunStub(options?.duplicatedRun ?? false);
  const service = new ConversationEngineService(
    conv,
    llm,
    accounts,
    wa,
    runs,
    {} as TenantContextService,
    {} as ToolExecutor,
  );
  return { service, conv, llm, accounts, wa, runs };
}

describe("ConversationEngineService.respond", () => {
  it("persiste el mensaje saliente exactamente una vez, con el wamid de Meta", async () => {
    const { service, conv, wa, runs } = setup();

    await service.respond(JOB);

    expect(conv.outbound).toHaveLength(1);
    expect(conv.outbound[0]).toEqual({
      providerMessageId: "wamid.HBg1",
      type: "text",
      content: "Hola",
    });
    expect(wa.sent).toEqual(["15550001111:Hola"]);
    expect(runs.succeeded).toHaveLength(1);
    expect(runs.succeeded[0].outboundMessageId).toBe("msg-1");
    expect(runs.failed).toHaveLength(0);
  });

  it("usa pending:<requestId> como providerMessageId si Meta no devuelve wamid", async () => {
    const { service, conv } = setup({ providerMessageId: undefined });

    await service.respond(JOB);

    expect(conv.outbound).toHaveLength(1);
    expect(conv.outbound[0].providerMessageId).toBe("pending:req-1");
  });

  it("no persiste ningún mensaje saliente si el envío a Meta falla", async () => {
    const { service, conv, llm, runs } = setup({
      sendError: new Error("Meta caído"),
    });

    await expect(service.respond(JOB)).rejects.toThrow("Meta caído");

    expect(llm.calls).toBe(1);
    expect(conv.outbound).toHaveLength(0);
    expect(runs.succeeded).toHaveLength(0);
    expect(runs.failed).toHaveLength(1);
    expect(runs.failed[0].errorCode).toBe("Error");
    expect(runs.failed[0].errorMessage).toBe("Meta caído");
  });

  it("no llama al modelo ni persiste nada cuando el run ya estaba registrado", async () => {
    const { service, conv, llm, wa, runs } = setup({ duplicatedRun: true });

    await service.respond(JOB);

    expect(llm.calls).toBe(0);
    expect(conv.outbound).toHaveLength(0);
    expect(wa.sent).toHaveLength(0);
    expect(runs.succeeded).toHaveLength(0);
    expect(runs.failed).toHaveLength(0);
  });

  it("marca SKIPPED sin tocar el modelo cuando la conversación no está en BOT_ACTIVE", async () => {
    const { service, conv, llm, runs } = setup();
    conv.getConversation = async () => ({
      ...CONVERSATION,
      status: "HUMAN_ACTIVE",
    });

    await service.respond(JOB);

    expect(llm.calls).toBe(0);
    expect(conv.outbound).toHaveLength(0);
    expect(runs.skipped).toBe(1);
    expect(runs.succeeded).toHaveLength(0);
  });
});
