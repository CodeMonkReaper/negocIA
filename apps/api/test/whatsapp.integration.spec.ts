import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../src/domain/errors";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { PrismaWhatsappAccountRepository } from "../src/infrastructure/database/repositories/prisma-whatsapp-account.repository";
import { PrismaWhatsappEventRepository } from "../src/infrastructure/database/repositories/prisma-whatsapp-event.repository";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

/**
 * Integración de los repositorios de WhatsApp (F2-3) contra PostgreSQL real.
 *
 * Lo interesante no se puede simular en memoria:
 *  - la UNIQUE de `whatsapp_events.provider_event_id` y la carrera que
 *    provoca `create → null`;
 *  - las transiciones `updateMany` con el status anterior en el `where`,
 *    que son disparadas por la BD y cuya idempotencia depende de ella;
 *  - el solapamiento de los dos UNIQUE de `whatsapp_accounts`
 *    (`waba_id`, `phone_number_id` por tenant) → 409.
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

async function buildRepositories() {
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
    events: module.get(PrismaWhatsappEventRepository),
    accounts: module.get(PrismaWhatsappAccountRepository),
    prisma: module.get(PrismaService),
  };
}

describe("PrismaWhatsappEventRepository (integration)", () => {
  let ctx: Awaited<ReturnType<typeof buildRepositories>>;

  beforeAll(async () => {
    ctx = await buildRepositories();
  });

  afterAll(async () => {
    await ctx.prisma.onModuleDestroy();
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it("inserta y reencuentra por provider_event_id", async () => {
    const row = await ctx.events.create({
      providerEventId: "wamid.1",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: { foo: "bar" },
    });

    expect(row.status).toBe("RECEIVED");

    const found = await ctx.events.findByProviderEventId("wamid.1");
    expect(found?.id).toBe(row.id);
    expect(found?.payload).toEqual({ foo: "bar" });
  });

  it("la carrera por el mismo provider_event_id devuelve null en el segundo create", async () => {
    const draft = {
      providerEventId: "wamid.race",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: {},
    };
    await ctx.events.create(draft);

    expect(await ctx.events.create(draft)).toBeNull();
  });

  it("markEnqueued mueve RECEIVED → ENQUEUED y es idempotente", async () => {
    const row = await ctx.events.create({
      providerEventId: "wamid.2",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: {},
    });

    await ctx.events.markEnqueued(row.id);
    expect((await ctx.events.findByProviderEventId("wamid.2"))?.status).toBe("ENQUEUED");

    // Repetir la transición no degrada el estado ni lanza.
    await ctx.events.markEnqueued(row.id);
    expect((await ctx.events.findByProviderEventId("wamid.2"))?.status).toBe("ENQUEUED");
  });

  it("markProcessed solo progresa desde ENQUEUED (no desde RECEIVED)", async () => {
    const row = await ctx.events.create({
      providerEventId: "wamid.3",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: {},
    });

    await ctx.events.markProcessed(row.id, new Date());
    expect((await ctx.events.findByProviderEventId("wamid.3"))?.status).toBe("RECEIVED");

    await ctx.events.markEnqueued(row.id);
    await ctx.events.markProcessed(row.id, new Date());
    expect((await ctx.events.findByProviderEventId("wamid.3"))?.status).toBe("PROCESSED");
  });

  it("markFailed acepta RECEIVED y ENQUEUED, y reaparece como retryable tras fallo de cola", async () => {
    const row1 = await ctx.events.create({
      providerEventId: "wamid.fail-1",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: {},
    });
    await ctx.events.markFailed(row1.id);
    expect((await ctx.events.findByProviderEventId("wamid.fail-1"))?.status).toBe("FAILED");

    const row2 = await ctx.events.create({
      providerEventId: "wamid.fail-2",
      tenantId: null,
      accountId: null,
      eventType: "message:text",
      payload: {},
    });
    await ctx.events.markEnqueued(row2.id);
    await ctx.events.markFailed(row2.id);
    expect((await ctx.events.findByProviderEventId("wamid.fail-2"))?.status).toBe("FAILED");

    // Un redelivery posterior vuelve a encolar desde FAILED.
    await ctx.events.markEnqueued(row2.id);
    expect((await ctx.events.findByProviderEventId("wamid.fail-2"))?.status).toBe("ENQUEUED");
  });
});

describe("PrismaWhatsappAccountRepository (integration)", () => {
  let ctx: Awaited<ReturnType<typeof buildRepositories>>;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    ctx = await buildRepositories();
  });

  afterAll(async () => {
    await ctx.prisma.onModuleDestroy();
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    tenantA = (await ctx.prisma.db.tenant.create({ data: { slug: "cafe-a", name: "Café A" } })).id;
    tenantB = (await ctx.prisma.db.tenant.create({ data: { slug: "cafe-b", name: "Café B" } })).id;
  });

  it("crea una cuenta activa y la resuelve por phone_number_id", async () => {
    await ctx.accounts.create({
      tenantId: tenantA,
      wabaId: "waba-1",
      phoneNumberId: "573001234567",
      accessToken: "token",
    });

    const found = await ctx.accounts.findByPhoneNumberId("573001234567");
    expect(found?.status).toBe("ACTIVE");
    expect(found?.tenantId).toBe(tenantA);
  });

  it("el solapamiento de phone_number_id en el mismo tenant es 409", async () => {
    await ctx.accounts.create({
      tenantId: tenantA,
      wabaId: "waba-1",
      phoneNumberId: "573001234567",
      accessToken: "token",
    });

    await expect(
      ctx.accounts.create({
        tenantId: tenantA,
        wabaId: "waba-2",
        phoneNumberId: "573001234567",
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("el solapamiento de waba_id en el mismo tenant también es 409", async () => {
    await ctx.accounts.create({
      tenantId: tenantA,
      wabaId: "waba-1",
      phoneNumberId: "573001234567",
      accessToken: "token",
    });

    await expect(
      ctx.accounts.create({
        tenantId: tenantA,
        wabaId: "waba-1",
        phoneNumberId: "573009999999",
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("aísla los listados por tenant", async () => {
    await ctx.accounts.create({
      tenantId: tenantA,
      wabaId: "waba-1",
      phoneNumberId: "573001234567",
      accessToken: "token",
    });
    await ctx.accounts.create({
      tenantId: tenantB,
      wabaId: "waba-2",
      phoneNumberId: "573009999999",
      accessToken: "token",
    });

    const listA = await ctx.accounts.listByTenant(tenantA);
    expect(listA).toHaveLength(1);
    expect(listA[0].phoneNumberId).toBe("573001234567");
    expect(await ctx.accounts.listByTenant(tenantB)).toHaveLength(1);
  });
});