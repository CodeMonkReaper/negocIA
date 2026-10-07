import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "../src/domain/errors";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { AuthService } from "../src/modules/auth/application/auth.service";
import { AuthModule } from "../src/modules/auth/auth.module";
import { TenantUsersService } from "../src/modules/tenants/application/tenant-users.service";
import { TenantService } from "../src/modules/tenants/application/tenant.service";
import { TenantsModule } from "../src/modules/tenants/tenants.module";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

const PASSWORD = "ContraseñaLarga1!";

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

interface Harness {
  tenantUsers: TenantUsersService;
  tenantService: TenantService;
  auth: AuthService;
  prisma: PrismaService;
}

async function harness(): Promise<Harness> {
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
      AuthModule,
      TenantsModule,
    ],
  }).compile();

  await module.init();

  return {
    tenantUsers: module.get(TenantUsersService),
    tenantService: module.get(TenantService),
    auth: module.get(AuthService),
    prisma: module.get(PrismaService),
  };
}

async function registerUser(
  h: Harness,
  email: string,
  name: string,
): Promise<{ userId: string; tenantId: string }> {
  const { user, tenant } = await h.auth.register({
    email,
    name,
    password: PASSWORD,
  });
  return { userId: user.id, tenantId: tenant.id };
}

/** Añade un miembro a un tenant pasando por los adaptadores reales. */
async function addMember(
  h: Harness,
  tenantId: string,
  role: "OWNER" | "ADMIN" | "AGENT",
): Promise<string> {
  const created = await registerUser(h, `miembro-${role}-${Date.now()}@example.com`, "Miembro");
  const user = await h.prisma.db.user.findUniqueOrThrow({ where: { id: created.userId } });
  await h.prisma.db.membership.create({
    data: { tenantId, userId: user.id, role },
  });
  return user.id;
}

/**
 * La invariante del último OWNER contra PostgreSQL real.
 *
 * La secuencia simple (un solo degradador) se cubre arriba y además en la
 * suite unitaria; lo que **solo** puede probarse aquí es la carrera: dos OWNER
 * que degradan al otro a la vez. Sin el `SELECT … FOR UPDATE` de
 * `lockActiveOwners`, ambos leerían `count = 2` y el tenant quedaría con 0
 * dueños; con el lock, uno commitea y el otro re-cuenta 1 y falla con 409.
 */
describe("TenantUsersService (integración PostgreSQL)", () => {
  let h: Harness;
  let tenantId: string;
  let ownerId: string;

  beforeEach(async () => {
    h = await harness();
    await resetDatabase();

    // Solo el OWNER fundador; los casos que necesitan un segundo dueño lo
    // añaden ellos mismos.
    const founder = await registerUser(h, "fundadora@example.com", "Fundadora");
    tenantId = founder.tenantId;
    ownerId = founder.userId;
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("degrada a un OWNER cuando queda otro activo", async () => {
    const secondOwnerId = await addMember(h, tenantId, "OWNER");

    const result = await h.tenantUsers.updateUser({
      tenantId,
      targetUserId: secondOwnerId,
      actorUserId: ownerId,
      actorRole: "OWNER",
      role: "ADMIN",
    });

    expect(result.role).toBe("ADMIN");

    const owners = await h.prisma.db.membership.count({
      where: { tenantId, role: "OWNER", status: "ACTIVE" },
    });
    expect(owners).toBe(1);
  });

  it("rechaza degradar al único OWNER → 409 y sin escrituras", async () => {
    const attempt = h.tenantUsers.updateUser({
      tenantId,
      targetUserId: ownerId,
      actorUserId: ownerId,
      actorRole: "OWNER",
      role: "AGENT",
    });

    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toMatchObject({ code: "conflict" });

    const member = await h.prisma.db.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId: ownerId } },
    });
    expect(member.role).toBe("OWNER");
    expect(member.status).toBe("ACTIVE");
  });

  it("rechaza desactivar al único OWNER → 409", async () => {
    const attempt = h.tenantUsers.updateUser({
      tenantId,
      targetUserId: ownerId,
      actorUserId: ownerId,
      actorRole: "OWNER",
      status: "INACTIVE",
    });

    await expect(attempt).rejects.toMatchObject({ code: "conflict" });
  });

  it("ADMIN no puede tocar a un OWNER, aunque ese OWNER sea su objetivo", async () => {
    const admin = await addMember(h, tenantId, "ADMIN");

    const attempt = h.tenantUsers.updateUser({
      tenantId,
      targetUserId: ownerId,
      actorUserId: admin,
      actorRole: "ADMIN",
      role: "AGENT",
    });

    await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
  });

  it("carrera: dos OWNER degradándose a la vez deja 1 OWNER y un 409", async () => {
    const secondOwnerId = await addMember(h, tenantId, "OWNER");
    const owner1 = ownerId;
    const owner2 = secondOwnerId;

    const results = await Promise.allSettled([
      h.tenantUsers.updateUser({
        tenantId,
        targetUserId: owner2,
        actorUserId: owner1,
        actorRole: "OWNER",
        role: "AGENT",
      }),
      h.tenantUsers.updateUser({
        tenantId,
        targetUserId: owner1,
        actorUserId: owner2,
        actorRole: "OWNER",
        role: "AGENT",
      }),
    ]);

    // La propiedad que protege la invariante: nunca 0 dueños. En el
    // intercalado común gana uno (200) y el otro ve `owners=1` (409); el
    // aserto se escribe tolerante al orden porque el ganador no está
    // garantizado, solo el resultado.
    const ownersAfter = await h.prisma.db.membership.count({
      where: { tenantId, role: "OWNER", status: "ACTIVE" },
    });
    expect(ownersAfter).toBe(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const result of rejected) {
      if (result.status === "rejected") {
        expect((result.reason as { code?: string }).code).toBe("conflict");
      }
    }
  });

  it("listUsers devuelve los miembros con su usuario", async () => {
    const members = await h.tenantUsers.listUsers(tenantId);

    expect(members).toHaveLength(1);
    expect(members[0].user.id).toBe(ownerId);
    expect(members[0].user.createdAt).toBeInstanceOf(Date);
  });
});

describe("TenantService (integración PostgreSQL)", () => {
  let h: Harness;
  let tenantId: string;

  beforeEach(async () => {
    h = await harness();
    await resetDatabase();
    const founder = await registerUser(h, "fundadora2@example.com", "Fundadora");
    tenantId = founder.tenantId;
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("edita y persiste name y slug", async () => {
    const updated = await h.tenantService.updateCurrent({
      tenantId,
      name: "Café de Ana",
      slug: "Café de Ana",
    });

    expect(updated.name).toBe("Café de Ana");
    expect(updated.slug).toBe("cafe-de-ana");

    const row = await h.prisma.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    expect(row.name).toBe("Café de Ana");
    expect(row.slug).toBe("cafe-de-ana");
  });

  it("slug de otro tenant → 409", async () => {
    const other = await registerUser(h, "otra-empresa@example.com", "Otra");
    await h.prisma.db.tenant.update({
      where: { id: other.tenantId },
      data: { slug: "cafe-ya-tomado" },
    });

    const attempt = h.tenantService.updateCurrent({
      tenantId,
      slug: "cafe-ya-tomado",
    });

    await expect(attempt).rejects.toMatchObject({ code: "conflict" });
  });
});