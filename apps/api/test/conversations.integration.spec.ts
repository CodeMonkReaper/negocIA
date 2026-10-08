import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { PrismaConversationRepository } from "../src/infrastructure/database/repositories/prisma-conversation.repository";
import { PrismaLlmRunRepository } from "../src/infrastructure/database/repositories/prisma-llm-run.repository";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

/**
 * Integración de `PrismaConversationRepository` (F2-4) contra PostgreSQL real.
 *
 * Lo que no se puede simular en memoria:
 *  - la UNIQUE de `messages.provider_message_id` y la transacción completa
 *    (`recordInboundMessage → "duplicated"` deshace la conversación creada);
 *  - el UNIQUE de `conversations(tenant_id, account_id, customer_wa_id)`, que
 *    materializa "una conversación por cliente y cuenta";
 *  - el aislamiento por tenant en lecturas y en escrituras de status.
 */
const TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "4000",
  LOG_LEVEL: "fatal",
  JWT_SECRET: "clave-de-integracion-de-32-bytes-minimo!!",
  JWT_ISSUER: "negocia-api",
  JWT_AUDIENCE: "negocia-app",
  JWT_ACCESS_TTL_SECONDS: "900",
  JWT_REFRESH_TTL_SECONDS: "2592000",
  ARGON2_MEMORY_COST: "8192",
  ARGON2_TIME_COST: "1",
  ARGON2_PARALLELISM: "1",
  META_DRIVER: "mock",
  META_WEBHOOK_VERIFY_TOKEN: "negocia-dev-verify-token",
  META_WEBHOOK_APP_SECRET: "negocia-dev-app-secret-f2-3",
  META_APP_ID: "1234567890",
  META_APP_SECRET: "abcdef1234567890abcdef1234567890",
  META_EMBEDDED_SIGNUP_REDIRECT_URI: "https://test.example.com",
  ENCRYPTION_KEY: "Wt633WemPkA4Zt8eUq2rM7Qecfuh8hv3Tvk3RYKRbwI=",
};

async function buildContext() {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        cache: true,
        load: [
          () =>
            validateEnv({
              ...process.env,
              ...TEST_ENV,
              DATABASE_URL: testUrl(),
            }),
        ],
      }),
      DatabaseModule,
    ],
  }).compile();

  await module.init();
  return {
    conversations: module.get(PrismaConversationRepository),
    runs: module.get(PrismaLlmRunRepository),
    prisma: module.get(PrismaService),
  };
}

type Ctx = Awaited<ReturnType<typeof buildContext>>;

async function seedTenantWithAccount(
  ctx: Ctx,
  slug: string,
  phoneNumberId: string,
): Promise<{ tenantId: string; accountId: string }> {
  const tenant = await ctx.prisma.db.tenant.create({
    data: { slug, name: slug },
  });
  const account = await ctx.prisma.db.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      wabaId: `waba-${slug}`,
      phoneNumberId,
      accessTokenEncrypted: {
        iv: "dGVzdC1pdjEyMw==",
        ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
        tag: "dGVzdC10YWc=",
      },
    },
  });
  return { tenantId: tenant.id, accountId: account.id };
}

const INBOUND = (id: string, waId = "573100000001") => ({
  providerMessageId: id,
  customerWaId: waId,
  customerName: "Ana Peña",
  type: "text",
  content: "Hola",
  timestamp: "1739737230",
  metadata: { raw: id },
});

describe("PrismaConversationRepository (integration)", () => {
  let ctx: Ctx;
  let tenantA: string;
  let accountA: string;

  beforeAll(async () => {
    ctx = await buildContext();
  });

  afterAll(async () => {
    await ctx.prisma.onModuleDestroy();
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    ({ tenantId: tenantA, accountId: accountA } = await seedTenantWithAccount(
      ctx,
      "cafe-a",
      "573001234567",
    ));
  });

  it("crea la conversación en BOT_ACTIVE y el mensaje INBOUND de forma atómica", async () => {
    const result = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.1"),
    );
    expect(result).not.toBe("duplicated");
    if (result !== "duplicated") {
      expect(result.conversation.status).toBe("BOT_ACTIVE");
      expect(result.conversation.customerWaId).toBe("573100000001");
      expect(result.conversation.customerName).toBe("Ana Peña");
      expect(result.conversation.lastMessageAt).not.toBeNull();
      expect(result.message.direction).toBe("INBOUND");
      expect(result.message.content).toBe("Hola");
    }
  });

  it("reutiliza la conversación del mismo cliente y cuenta (nuevo mensaje, misma conversación)", async () => {
    const first = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.1"),
    );
    const second = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.2"),
    );
    expect(first).not.toBe("duplicated");
    expect(second).not.toBe("duplicated");
    if (first !== "duplicated" && second !== "duplicated") {
      expect(second.conversation.id).toBe(first.conversation.id);
      expect(await ctx.prisma.db.conversation.count()).toBe(1);
      expect(second.message.id).not.toBe(first.message.id);
    }
  });

  it("devuelve 'duplicated' si el providerMessageId ya existe y no duplica mensajes", async () => {
    const first = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.dup"),
    );
    const duplicated = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.dup", "573100000002"),
    );
    expect(duplicated).toBe("duplicated");
    expect(await ctx.prisma.db.message.count()).toBe(1);
    expect(first).not.toBe("duplicated");
  });

  it("recordDeliveryStatus actualiza el mensaje del tenant y es no-op si no existe", async () => {
    await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.out"),
    );
    const message = await ctx.prisma.db.message.findUniqueOrThrow({
      where: { providerMessageId: "wamid.out" },
    });

    expect(
      await ctx.conversations.recordDeliveryStatus(tenantA, {
        providerMessageId: "wamid.out",
        deliveryStatus: "delivered",
      }),
    ).toBe(true);
    expect(
      (await ctx.prisma.db.message.findUniqueOrThrow({ where: { id: message.id } }))
        .deliveryStatus,
    ).toBe("delivered");

    // El mismo mensaje pero desde otro tenant: no-op, no toca la fila ajena.
    expect(
      await ctx.conversations.recordDeliveryStatus(randomUUID(), {
        providerMessageId: "wamid.out",
        deliveryStatus: "read",
      }),
    ).toBe(false);

    // Un status de un mensaje nunca escrito: no-op.
    expect(
      await ctx.conversations.recordDeliveryStatus(tenantA, {
        providerMessageId: "wamid.nunca-existio",
        deliveryStatus: "read",
      }),
    ).toBe(false);
  });

  it("listByTenant aísla por tenant y filtra por status", async () => {
    await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.a1"),
    );

    const { tenantId: tenantB, accountId: accountB } = await seedTenantWithAccount(
      ctx,
      "cafe-b",
      "573009999999",
    );
    await ctx.conversations.recordInboundMessage(
      { tenantId: tenantB, accountId: accountB },
      INBOUND("wamid.b1", "573100000009"),
    );

    const pageA = await ctx.conversations.listByTenant(tenantA, {
      limit: 20,
      offset: 0,
    });
    expect(pageA.total).toBe(1);
    expect(pageA.items[0].customerWaId).toBe("573100000001");

    // BOT_ACTIVE matchea, CLOSED (inexistente) vacía la página.
    const bot = await ctx.conversations.listByTenant(tenantA, {
      limit: 20,
      offset: 0,
      status: "BOT_ACTIVE",
    });
    expect(bot.total).toBe(1);
    const closed = await ctx.conversations.listByTenant(tenantA, {
      limit: 20,
      offset: 0,
      status: "CLOSED",
    });
    expect(closed.total).toBe(0);
  });

  it("listMessages devuelve en orden cronológico, pagina y respeta el tenant", async () => {
    const first = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.m1"),
    );
    if (first === "duplicated") {
      throw new Error("setup fallido");
    }
    const conversationId = first.conversation.id;

    await new Promise((resolve) => setTimeout(resolve, 15));
    await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.m2"),
    );

    const page = await ctx.conversations.listMessages(tenantA, conversationId, {
      limit: 20,
      offset: 0,
    });
    expect(page.total).toBe(2);
    expect(page.items.map((m) => m.providerMessageId)).toEqual(["wamid.m1", "wamid.m2"]);

    const firstPage = await ctx.conversations.listMessages(tenantA, conversationId, {
      limit: 1,
      offset: 0,
    });
    const secondPage = await ctx.conversations.listMessages(tenantA, conversationId, {
      limit: 1,
      offset: 1,
    });
    expect(firstPage.items.map((m) => m.providerMessageId)).toEqual(["wamid.m1"]);
    expect(secondPage.items.map((m) => m.providerMessageId)).toEqual(["wamid.m2"]);

    // Una conversación ajena no filtra mensajes del tenant propio.
    const foreign = await ctx.conversations.listMessages(tenantA, randomUUID(), {
      limit: 20,
      offset: 0,
    });
    expect(foreign.total).toBe(0);
  });

  it("findById solo encuentra conversaciones del tenant", async () => {
    const created = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      INBOUND("wamid.f1"),
    );
    if (created === "duplicated") {
      throw new Error("setup fallido");
    }
    expect(
      (await ctx.conversations.findById(tenantA, created.conversation.id))?.id,
    ).toBe(created.conversation.id);
    expect(
      await ctx.conversations.findById(randomUUID(), created.conversation.id),
    ).toBeNull();
  });
});

describe("PrismaLlmRunRepository.listByConversation (integration)", () => {
  let ctx: Ctx;
  let tenantA: string;
  let accountA: string;

  beforeAll(async () => {
    ctx = await buildContext();
  });

  afterAll(async () => {
    await ctx.prisma.onModuleDestroy();
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    ({ tenantId: tenantA, accountId: accountA } = await seedTenantWithAccount(
      ctx,
      "cafe-runs",
      "573001234561",
    ));
  });

  async function seedConversationWithRuns(
    slug: string,
    count: number,
  ): Promise<string> {
    const inbound = await ctx.conversations.recordInboundMessage(
      { tenantId: tenantA, accountId: accountA },
      {
        ...INBOUND(`wamid.runs-${slug}`, `5731${slug}0001`),
        customerName: `Cliente ${slug}`,
      },
    );
    if (inbound === "duplicated") {
      throw new Error("setup fallido");
    }
    const { conversation, message } = inbound;
    for (let i = 0; i < count; i += 1) {
      await ctx.prisma.db.llmRun.create({
        data: {
          tenantId: tenantA,
          conversationId: conversation.id,
          inboundMessageId: message.id,
          requestId: `req.runs.${slug}.${i}`,
          driver: "openrouter",
          requestedModel: "openai/gpt-4o-mini",
          status: i % 2 === 0 ? "SUCCEEDED" : "FAILED",
          promptTokens: 10 + i,
          completionTokens: 5,
          totalTokens: 15 + i,
          latencyMs: 100 + i,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return conversation.id;
  }

  it("lista las runs de la conversación en orden cronológico inverso", async () => {
    const conversationId = await seedConversationWithRuns("a", 3);

    const page = await ctx.runs.listByConversation(tenantA, conversationId, {
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(3);
    // requestId más antiguo primero en creación → el 2 es el más reciente.
    expect(page.items[0].requestId).toBe("req.runs.a.2");
    expect(page.items.map((r) => r.status)).toEqual(["SUCCEEDED", "FAILED", "SUCCEEDED"]);
  });

  it("aísla por tenant: un conversationId ajeno devuelve página vacía", async () => {
    const conversationId = await seedConversationWithRuns("b", 1);

    const page = await ctx.runs.listByConversation(randomUUID(), conversationId, {
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
  });

  it("pagina con limit/offset", async () => {
    const conversationId = await seedConversationWithRuns("c", 3);

    const first = await ctx.runs.listByConversation(tenantA, conversationId, {
      limit: 1,
      offset: 0,
    });
    const second = await ctx.runs.listByConversation(tenantA, conversationId, {
      limit: 1,
      offset: 1,
    });

    expect(first.items).toHaveLength(1);
    expect(first.items[0].requestId).toBe("req.runs.c.2");
    expect(second.items[0].requestId).toBe("req.runs.c.1");
  });
});