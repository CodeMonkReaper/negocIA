import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { PrismaProductRepository } from "../src/infrastructure/database/repositories/prisma-product.repository";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

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
  EMAIL_DRIVER: "mock",
  EMAIL_FROM: "test@example.com",
  EMAIL_FROM_NAME: "negocIA Test",
  APP_BASE_URL: "http://localhost:3000",
  REDIS_URL: "redis://localhost:6379",
  LLM_DRIVER: "mock",
  ENCRYPTION_KEY: "Wt633WemPkA4Zt8eUq2rM7Qecfuh8hv3Tvk3RYKRbwI=",
};

describe("PrismaProductRepository (integration)", () => {
  let prisma: PrismaService;
  let repo: PrismaProductRepository;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
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
      providers: [PrismaProductRepository],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    repo = moduleRef.get(PrismaProductRepository);
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    tenantA = randomUUID();
    tenantB = randomUUID();
    await prisma.db.tenant.createMany({
      data: [
        { id: tenantA, slug: `t-a-${tenantA.slice(0, 8)}`, name: "Tenant A" },
        { id: tenantB, slug: `t-b-${tenantB.slice(0, 8)}`, name: "Tenant B" },
      ],
    });
  });

  it("crea un producto y lo lee por id asegurando aislamiento por tenant", async () => {
    const created = await repo.create(tenantA, {
      name: "Café de Especialidad",
      description: "Grano tostado medio",
      price: 9500,
      currency: "CLP",
      type: "PRODUCT",
      category: "Bebidas",
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Café de Especialidad");
    expect(created.price).toBe(9500);

    const foundInA = await repo.findById(tenantA, created.id);
    expect(foundInA?.id).toBe(created.id);

    // Tenant B no puede acceder
    const foundInB = await repo.findById(tenantB, created.id);
    expect(foundInB).toBeNull();
  });

  it("actualiza y elimina respetando el tenant", async () => {
    const created = await repo.create(tenantA, {
      name: "Corte Express",
      price: 8000,
      type: "SERVICE",
      durationMinutes: 30,
    });

    const updated = await repo.update(tenantA, created.id, {
      price: 10000,
      durationMinutes: 35,
    });
    expect(updated?.price).toBe(10000);
    expect(updated?.durationMinutes).toBe(35);

    // Tenant B no puede actualizar
    const updatedInB = await repo.update(tenantB, created.id, { price: 5000 });
    expect(updatedInB).toBeNull();

    // Eliminar en tenant A
    const deleted = await repo.delete(tenantA, created.id);
    expect(deleted).toBe(true);

    const notFound = await repo.findById(tenantA, created.id);
    expect(notFound).toBeNull();
  });

  it("search filtra por término insensible a mayúsculas", async () => {
    await repo.create(tenantA, { name: "Corte Caballero", price: 10000 });
    await repo.create(tenantA, { name: "Corte Dama", price: 15000 });
    await repo.create(tenantA, { name: "Manicure Clásica", price: 8000 });
    await repo.create(tenantB, { name: "Corte de otro tenant", price: 9000 });

    const results = await repo.search(tenantA, "corte");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.tenantId === tenantA)).toBe(true);
  });
});

