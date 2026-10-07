import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { PrismaDependencyProbe } from "../src/infrastructure/database/prisma-dependency-probe";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

/**
 * Integración de la sonda de dependencias contra PostgreSQL real.
 *
 * Un doble en memoria que devuelve `up` probaría el test, no la sonda. Lo que
 * no se puede simular aquí es que `SELECT 1` realmente viaje por el socket, y
 * que una DSN rota produzca `down` en vez de una excepción sin capturar.
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

async function buildProbe(connectionString: string) {
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
              DATABASE_URL: connectionString,
            }),
        ],
      }),
      DatabaseModule,
    ],
  }).compile();

  await module.init();
  return { probe: module.get(PrismaDependencyProbe), prisma: module.get(PrismaService) };
}

describe("PrismaDependencyProbe (integration)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("reporta up con una base de datos alcanzable", async () => {
    const { probe, prisma } = await buildProbe(testUrl());

    const status = await probe.check();

    expect(status).toMatchObject({ name: "postgresql", status: "up" });
    expect(typeof status.latencyMs).toBe("number");
    expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    expect(status.error).toBeUndefined();

    await prisma.onModuleDestroy();
  });

  /**
   * Lo importante no es que falle, sino que **no lance**. Un rechazo aquí
   * llegaría a `HealthService.ready` como excepción y el endpoint público de
   * diagnóstico respondería 500 sin cuerpo, que es justo el fallo que
   *_arrancaba a corregir.
   */
  it("reporta down, sin lanzar, cuando la conexión es imposible", async () => {
    const { probe, prisma } = await buildProbe(
      "postgresql://negocia:negocia@127.0.0.1:1/negocia_test?schema=negocia_test",
    );

    const status = await probe.check();

    expect(status.status).toBe("down");
    expect(status.name).toBe("postgresql");

    await prisma.onModuleDestroy();
  });

  /**
   * `/api/health/ready` es `@Public()`. El mensaje de error de `pg` puede
   * incluir la DSN completa, con la contraseña, así que la sonda expone la
   * clase del error y nunca el mensaje.
   */
  it("no filtra la DSN ni la contraseña en el motivo del fallo", async () => {
    const password = "clave-secreta-de-prueba";
    const { probe, prisma } = await buildProbe(
      `postgresql://negocia:${password}@127.0.0.1:1/negocia_test?schema=negocia_test`,
    );

    const status = await probe.check();

    expect(status.status).toBe("down");
    expect(JSON.stringify(status)).not.toContain(password);
    expect(status.error).not.toContain("postgresql://");

    await prisma.onModuleDestroy();
  });
});
