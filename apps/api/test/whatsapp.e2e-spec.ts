import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { api, createTestApp, resetThrottler } from "./helpers/app";
import { closeTestDatabase, resetDatabase } from "./helpers/database";

/**
 * E2E del canal Meta WhatsApp (F2-3): webhook + cuentas.
 *
 * El GET de verificación y el POST de eventos son públicos por diseño (los
 * llama Meta), así que su seguridad vive en el `hub.verify_token` y en la
 * firma `X-Hub-Signature-256`. Las cuentas, en cambio, pasan por la cadena de
 * auth con rol OWNER.
 */

const PASSWORD = "ContraseñaLarga1!";
const APP_SECRET = process.env.META_WEBHOOK_APP_SECRET as string;
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN as string;

const WABA_ID = "111222333";
const PHONE_NUMBER_ID = "573001234567";
const EVENT_ID = "wamid.HBgNMTE4MjcwNzc4OkVTQh";

function sign(rawBody: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function metaPayload(phoneNumberId = PHONE_NUMBER_ID) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "351468654316532",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "573001234567", phone_number_id: phoneNumberId },
              messages: [{ from: "573100000001", id: EVENT_ID, timestamp: "1739737230", type: "text" }],
            },
          },
        ],
      },
    ],
  };
}

interface SessionBody {
  accessToken: string;
  user: { email: string; name: string };
  tenant: { id: string };
  membership: { role: string; status: string };
}

let app: INestApplication;
let http: Server;
let emails: MockEmailAdapter;
let prisma: PrismaService;

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

/** Invita y acepta a `target` en el tenant de `owner` con el rol pedido. */
async function addMemberAs(
  owner: SessionBody,
  target: SessionBody,
  role: "ADMIN" | "AGENT" = "AGENT",
): Promise<SessionBody> {
  const invite = await request(http)
    .post(api("/invitations"))
    .set(...bearer(owner.accessToken))
    .send({ email: target.user.email, role });
  expect(invite.status).toBe(201);

  const accept = await request(http)
    .post(api("/invitations/accept"))
    .set(...bearer(target.accessToken))
    .send({ token: lastInviteToken() });
  expect(accept.status).toBe(200);
  return { ...target, ...(accept.body as Partial<SessionBody>) };
}

async function connectAccount(token: string, phoneNumberId = PHONE_NUMBER_ID): Promise<void> {
  const res = await request(http)
    .post(api("/whatsapp/accounts"))
    .set(...bearer(token))
    .send({
      wabaId: WABA_ID,
      phoneNumberId,
      displayPhone: "573001234567",
      accessToken: "EAAJv0000000000000000token-de-prueba",
    });
  expect(res.status).toBe(201);
}

function getWebhookUrl(query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return `/api/v1/whatsapp/webhook${qs ? `?${qs}` : ""}`;
}

function postWebhook(payload: unknown, overrides: { signature?: string } = {}) {
  const rawBody = JSON.stringify(payload);
  return request(http)
    .post(api("/whatsapp/webhook"))
    .set("Content-Type", "application/json")
    .set("X-Hub-Signature-256", overrides.signature ?? sign(rawBody))
    .send(rawBody);
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

describe("GET /whatsapp/webhook (verificación de suscripción)", () => {
  it("devuelve el challenge crudo como text/plain cuando el token es válido", async () => {
    const token = "challenge-789";
    const res = await request(http).get(
      getWebhookUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": token }),
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toBe(token);
  });

  it("rechaza con 403 un verify token equivocado", async () => {
    const res = await request(http).get(
      getWebhookUrl({ "hub.mode": "subscribe", "hub.verify_token": "token-roto", "hub.challenge": "x" }),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("webhook_verification_failed");
  });

  it("rechaza con 403 si no llega hub.challenge", async () => {
    const res = await request(http).get(
      getWebhookUrl({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN }),
    );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("webhook_verification_failed");
  });
});

describe("POST /whatsapp/webhook (ingesta de eventos)", () => {
  async function connectOwnedAccount(): Promise<string> {
    const owner = await register("duena@example.com", "Dueña");
    await connectAccount(owner.accessToken);
    return owner.accessToken;
  }

  it("devuelve 401 si no llega la firma", async () => {
    const res = await request(http)
      .post(api("/whatsapp/webhook"))
      .set("Content-Type", "application/json")
      .send(JSON.stringify(metaPayload()));

    expect(res.status).toBe(401);
  });

  it("devuelve 401 si la firma no corresponde al body", async () => {
    const res = await postWebhook(metaPayload(), {
      signature: sign("otro-cuerpo"),
    });

    expect(res.status).toBe(401);
    expect(await prisma.db.whatsappEvent.count()).toBe(0);
  });

  it("persiste y encola el evento de una cuenta conectada", async () => {
    await connectOwnedAccount();

    const res = await postWebhook(metaPayload());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handled: 1, ignored: 0, duplicated: 0 });
    const row = await prisma.db.whatsappEvent.findUnique({
      where: { providerEventId: EVENT_ID },
    });
    expect(row?.status).toBe("ENQUEUED");
    expect(row?.tenantId).toBeTruthy();
  });

  it("es idempotente: reenviar el mismo evento no crea una segunda fila", async () => {
    await connectOwnedAccount();

    const first = await postWebhook(metaPayload());
    expect(first.status).toBe(200);

    const second = await postWebhook(metaPayload());
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ handled: 0, ignored: 0, duplicated: 1 });
    expect(await prisma.db.whatsappEvent.count()).toBe(1);
  });

  it("ignora los eventos de números que no tenemos conectados", async () => {
    await connectOwnedAccount();

    const res = await postWebhook(metaPayload("573000000000"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handled: 0, ignored: 1, duplicated: 0 });
    expect(await prisma.db.whatsappEvent.count()).toBe(0);
  });

  it("responde 200 a un payload inválido sin tocar la base", async () => {
    await connectOwnedAccount();

    const res = await postWebhook({ nope: true });

    expect(res.status).toBe(200);
    expect(await prisma.db.whatsappEvent.count()).toBe(0);
  });
});

describe("POST /whatsapp/accounts (alta manual, solo OWNER)", () => {
  it("conecta el WABA y nunca devuelve el access token", async () => {
    const owner = await register("duena@example.com", "Dueña");
    const res = await request(http)
      .post(api("/whatsapp/accounts"))
      .set(...bearer(owner.accessToken))
      .send({
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        displayPhone: "573001234567",
        accessToken: "EAAJv-secreto",
      });

    expect(res.status).toBe(201);
    expect(res.body.phoneNumberId).toBe(PHONE_NUMBER_ID);
    expect(JSON.stringify(res.body)).not.toContain("accessToken");
    expect(JSON.stringify(res.body)).not.toContain("secreto");
  });

  it("rechaza cuentas duplicadas con 409", async () => {
    const owner = await register("duena@example.com", "Dueña");
    await connectAccount(owner.accessToken);

    const res = await request(http)
      .post(api("/whatsapp/accounts"))
      .set(...bearer(owner.accessToken))
      .send({
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: "EAAJv-otro-token",
      });

    expect(res.status).toBe(409);
  });

  it("no deja conectar a un miembro sin rol OWNER (ADMIN → 403)", async () => {
    const owner = await register("duena@example.com", "Dueña");
    const admin = await register("carla@example.com", "Carla Ruiz");
    const adminInTenant = await addMemberAs(owner, admin, "ADMIN");

    const res = await request(http)
      .post(api("/whatsapp/accounts"))
      .set(...bearer(adminInTenant.accessToken))
      .send({
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: "EAAJv-secreto",
      });

    expect(res.status).toBe(403);
  });

  it("lista las cuentas del tenant solo al miembro autenticado", async () => {
    const owner = await register("duena@example.com", "Dueña");
    await connectAccount(owner.accessToken);

    const res = await request(http)
      .get(api("/whatsapp/accounts"))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].accessToken).toBeUndefined();

    const invitee = await register("otra@example.com", "Otra Persona");
    const other = await request(http)
      .get(api("/whatsapp/accounts"))
      .set(...bearer(invitee.accessToken));
    expect(other.body.items).toHaveLength(0);
  });

  it("valida el contrato del body", async () => {
    const owner = await register("duena@example.com", "Dueña");
    const res = await request(http)
      .post(api("/whatsapp/accounts"))
      .set(...bearer(owner.accessToken))
      .send({ wabaId: "abc", phoneNumberId: PHONE_NUMBER_ID, accessToken: "corto" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});