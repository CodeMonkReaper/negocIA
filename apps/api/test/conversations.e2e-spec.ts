import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { api, createTestApp, resetThrottler } from "./helpers/app";
import { closeTestDatabase, resetDatabase } from "./helpers/database";

/**
 * E2E de lectura de conversaciones y mensajes (F2-4).
 *
 * La ingesta de mensajes la hace el worker (proceso aparte, `pnpm start:worker`),
 * así que aquí se siembran la cuenta + conversación + mensajes directamente y se
 * prueba la capa HTTP: roles, aislamiento por tenant, paginación y 404 de
 * conversaciones ajenas.
 */

const PASSWORD = "ContraseñaLarga1!";
const PHONE_NUMBER_ID = "573001234567";
const CUSTOMER_WA_ID = "573100000001";

interface SessionBody {
  accessToken: string;
  user: { email: string; name: string };
  tenant: { id: string };
  membership: { role: string; status: string };
}

let app: INestApplication;
let http: Server;
let prisma: PrismaService;
let emails: MockEmailAdapter;

async function register(email: string, name: string): Promise<SessionBody> {
  const res = await request(http)
    .post(api("/auth/register"))
    .send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body as SessionBody;
}

function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

function lastInviteToken(): string {
  const token = emails.sent.filter((m) => m.template === "invitation").at(-1)?.token;
  if (!token) {
    throw new Error("no hay token de invitación capturado");
  }
  return token;
}

interface SeededConversation {
  tenantId: string;
  conversationId: string;
  messageIds: string[];
}

/** Siembra un run de LLM SUCCEEDED sobre un mensaje de la conversación. */
async function seedRun(
  tenantId: string,
  conversationId: string,
  messageId: string,
  requestId: string,
  createdAtOffsetMs = 0,
): Promise<void> {
  await prisma.db.llmRun.create({
    data: {
      tenantId,
      conversationId,
      inboundMessageId: messageId,
      requestId,
      driver: "openrouter",
      requestedModel: "openai/gpt-4o-mini",
      resolvedModel: "openai/gpt-4o-mini",
      status: "SUCCEEDED",
      finishReason: "stop",
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
      toolCalls: 0,
      attempts: 1,
      latencyMs: 150,
      completedAt: new Date(),
      createdAt: new Date(Date.now() + createdAtOffsetMs),
    },
  });
}

/** Crea la cuenta y siembra una conversación con dos mensajes de prueba. */
async function seedConversation(tenantId: string): Promise<SeededConversation> {
  const uid = randomUUID().slice(0, 8);
  const account = await prisma.db.whatsappAccount.create({
    data: {
      tenantId,
      wabaId: `waba-e2e-${uid}`,
      phoneNumberId: PHONE_NUMBER_ID,
      accessTokenEncrypted: {
        iv: "dGVzdC1pdjEyMw==",
        ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
        tag: "dGVzdC10YWc=",
      },
    },
  });
  const conversation = await prisma.db.conversation.create({
    data: {
      tenantId,
      accountId: account.id,
      customerWaId: CUSTOMER_WA_ID,
      customerName: "María Peña",
      lastMessageAt: new Date(),
    },
  });
  const messageA = await prisma.db.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      // provider_message_id es UNIQUE global: el prefijo del tenant lo hace único.
      providerMessageId: `wamid.e2e-${uid}-1`,
      direction: "INBOUND",
      type: "text",
      content: "Hola",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const messageB = await prisma.db.message.create({
    data: {
      tenantId,
      conversationId: conversation.id,
      providerMessageId: `wamid.e2e-${uid}-2`,
      direction: "INBOUND",
      type: "text",
      content: "¿Menú vegano?",
    },
  });
  return {
    tenantId,
    conversationId: conversation.id,
    messageIds: [messageA.id, messageB.id],
  };
}

beforeAll(async () => {
  app = await createTestApp();
  http = app.getHttpServer() as Server;
  emails = app.get(MockEmailAdapter);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
  await closeTestDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  emails.clear();
  await resetThrottler(app);
});

describe("GET /conversations (lectura)", () => {
  it("exige sesión (401 sin token)", async () => {
    const res = await request(http).get(api("/conversations"));
    expect(res.status).toBe(401);
  });

  it("devuelve solo las conversaciones del tenant del principal", async () => {
    const owner = await register("cafe@example.com", "Café");
    await seedConversation(owner.tenant.id);

    const other = await register("otra@example.com", "Otra Cafetería");
    await seedConversation(other.tenant.id);

    const res = await request(http)
      .get(api("/conversations"))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      customerWaId: CUSTOMER_WA_ID,
      customerName: "María Peña",
      status: "BOT_ACTIVE",
    });
    expect(res.body.items[0].lastMessageAt).toBeTruthy();
    expect(res.body.items[0].id).toBeTypeOf("string");
  });

  it("un AGENT del tenant también puede leerla (rol mínimo)", async () => {
    const owner = await register("duena@example.com", "Dueña");
    await seedConversation(owner.tenant.id);
    const agent = await register("pedro@example.com", "Pedro Agente");
    const invite = await request(http)
      .post(api("/invitations"))
      .set(...bearer(owner.accessToken))
      .send({ email: agent.user.email, role: "AGENT" });
    expect(invite.status).toBe(201);
    const accept = await request(http)
      .post(api("/invitations/accept"))
      .set(...bearer(agent.accessToken))
      .send({ token: lastInviteToken() });
    expect(accept.status).toBe(200);
    // El access token del accept reencuadra la sesión en el tenant del owner.
    const agentInTenant = { ...agent, ...(accept.body as Partial<SessionBody>) };

    const res = await request(http)
      .get(api("/conversations"))
      .set(...bearer(agentInTenant.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("filtra por status y valida el filtro (400 con status inválido)", async () => {
    const owner = await register("cafe@example.com", "Café");
    await seedConversation(owner.tenant.id);

    const bot = await request(http)
      .get(api("/conversations?status=BOT_ACTIVE"))
      .set(...bearer(owner.accessToken));
    expect(bot.status).toBe(200);
    expect(bot.body.total).toBe(1);

    const closed = await request(http)
      .get(api("/conversations?status=CLOSED"))
      .set(...bearer(owner.accessToken));
    expect(closed.status).toBe(200);
    expect(closed.body.total).toBe(0);

    const bad = await request(http)
      .get(api("/conversations?status=NO_EXISTE"))
      .set(...bearer(owner.accessToken));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("validation_error");
  });

  it("pagina con limit/offset y valida límites (limit > 100 → 400)", async () => {
    const owner = await register("cafe@example.com", "Café");
    await seedConversation(owner.tenant.id);

    const page = await request(http)
      .get(api("/conversations?limit=1&offset=0"))
      .set(...bearer(owner.accessToken));
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(page.body.items).toHaveLength(1);

    const bad = await request(http)
      .get(api("/conversations?limit=101"))
      .set(...bearer(owner.accessToken));
    expect(bad.status).toBe(400);
  });
});

describe("GET /conversations/:id/messages", () => {
  it("devuelve los mensajes en orden cronológico para el dueño", async () => {
    const owner = await register("cafe@example.com", "Café");
    const seeded = await seedConversation(owner.tenant.id);

    const res = await request(http)
      .get(api(`/conversations/${seeded.conversationId}/messages`))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((m: { content: string }) => m.content)).toEqual([
      "Hola",
      "¿Menú vegano?",
    ]);
    expect(res.body.items[0]).toMatchObject({
      direction: "INBOUND",
      type: "text",
      deliveryStatus: null,
    });
  });

  it("devuelve 404 para una conversación de otro tenant (indistinguible de inexistente)", async () => {
    const ownerA = await register("cafe@example.com", "Café A");
    const seeded = await seedConversation(ownerA.tenant.id);

    const ownerB = await register("cafe-b@example.com", "Café B");
    await seedConversation(ownerB.tenant.id);

    // ownerA pide la conversación de ownerB: 404, no 403 (no revelar existencia).
    const res = await request(http)
      .get(api(`/conversations/${seeded.conversationId}/messages`))
      .set(...bearer(ownerB.accessToken));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("valida el formato del :id (400 con un id que no es uuid)", async () => {
    const owner = await register("cafe@example.com", "Café");
    const res = await request(http)
      .get(api("/conversations/no-es-un-uuid/messages"))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

describe("GET /conversations/:id/runs", () => {
  it("devuelve las runs de la conversación, la más reciente primero", async () => {
    const owner = await register("cafe@example.com", "Café");
    const seeded = await seedConversation(owner.tenant.id);
    await seedRun(
      owner.tenant.id,
      seeded.conversationId,
      seeded.messageIds[0],
      "req.e2e.1",
    );
    await seedRun(
      owner.tenant.id,
      seeded.conversationId,
      seeded.messageIds[0],
      "req.e2e.2",
      2_000,
    );

    const res = await request(http)
      .get(api(`/conversations/${seeded.conversationId}/runs`))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].requestId).toBe("req.e2e.2");
    expect(res.body.items[0]).toMatchObject({
      status: "SUCCEEDED",
      driver: "openrouter",
      requestedModel: "openai/gpt-4o-mini",
      totalTokens: 20,
      latencyMs: 150,
    });
    expect(res.body.items[0].completedAt).toBeTruthy();
    expect(res.body.items[0].createdAt).toBeTypeOf("string");
  });

  it("devuelve 404 para una conversación de otro tenant (indistinguible de inexistente)", async () => {
    const ownerA = await register("cafe@example.com", "Café A");
    const seeded = await seedConversation(ownerA.tenant.id);
    await seedRun(
      ownerA.tenant.id,
      seeded.conversationId,
      seeded.messageIds[0],
      "req.e2e.foraneo",
    );

    const ownerB = await register("cafe-b@example.com", "Café B");

    const res = await request(http)
      .get(api(`/conversations/${seeded.conversationId}/runs`))
      .set(...bearer(ownerB.accessToken));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("valida el formato del :id (400 con un id que no es uuid)", async () => {
    const owner = await register("cafe@example.com", "Café");
    const res = await request(http)
      .get(api("/conversations/no-es-un-uuid/runs"))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});