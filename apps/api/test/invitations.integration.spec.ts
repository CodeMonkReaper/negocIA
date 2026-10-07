import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, InvalidTokenError } from "../src/domain/errors";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { AuthService } from "../src/modules/auth/application/auth.service";
import { AuthModule } from "../src/modules/auth/auth.module";
import { InvitationsModule } from "../src/modules/invitations/invitations.module";
import { InvitationsService } from "../src/modules/invitations/application/invitations.service";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

/**
 * Integración de M-5 contra PostgreSQL real.
 *
 * Monta el grafo de DI real (`DatabaseModule` + `AuthModule` +
 * `InvitationsModule`) contra el schema `negocia_test`, de modo que se cubren
 * a la vez los adaptadores de Prisma y los bindings de puertos.
 *
 * Lo que se prueba aquí y no puede probarse en memoria:
 *
 *  - El índice parcial `invitations_tenant_id_email_pending_key` rechazando dos
 *    invitaciones concurrentes al mismo email con `P2002`.
 *  - La atomicidad del `updateMany` condicional en `accept`: dos aceptaciones
 *    simultáneas del mismo token, y solo una gana.
 *  - Que el `consume`/`revoke` por `status = 'PENDING'` no dependa de un `find`
 *    previo, que es donde un doble en memoria siempre parece correcto.
 *  - La traducción de `P2002` a errores de dominio.
 */

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
  invitations: InvitationsService;
  auth: AuthService;
  email: MockEmailAdapter;
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
      InvitationsModule,
    ],
  }).compile();

  await module.init();

  return {
    invitations: module.get(InvitationsService),
    auth: module.get(AuthService),
    email: module.get(MockEmailAdapter),
    prisma: module.get(PrismaService),
  };
}

function register(h: Harness, email: string, name: string) {
  return h.auth.register({ email, name, password: PASSWORD });
}

function lastInvitationToken(h: Harness): string {
  const message = h.email.sent.filter((m) => m.template === "invitation").at(-1);
  if (!message?.token) {
    throw new Error("El test esperaba un email de invitación con token");
  }
  return message.token;
}

async function setPlan(h: Harness, tenantId: string, plan: string): Promise<void> {
  await h.prisma.db.tenant.update({ where: { id: tenantId }, data: { plan } });
}

describe("M-5 Invitaciones (integración con PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("crea la invitación y persiste solo el hash del token", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");

    const invitation = await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });

    const token = lastInvitationToken(h);
    expect(invitation.status).toBe("PENDING");
    expect(invitation.role).toBe("AGENT");
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const row = await h.prisma.db.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("acepta, crea la membresía y verifica el email de forma atómica", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    const pedro = await register(h, "pedro@example.com", "Pedro Ruiz");
    await setPlan(h, owner.tenant.id, "PRO");

    await h.invitations.create({
      email: "pedro@example.com",
      role: "ADMIN",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });

    const accepted = await h.invitations.accept({
      token: lastInvitationToken(h),
      email: "pedro@example.com",
    });

    expect(accepted.tenantId).toBe(owner.tenant.id);
    expect(accepted.role).toBe("ADMIN");

    const membership = await h.prisma.db.membership.findFirstOrThrow({
      where: { tenantId: owner.tenant.id, userId: pedro.user.id },
    });
    expect(membership.role).toBe("ADMIN");
    expect(membership.status).toBe("ACTIVE");

    const user = await h.prisma.db.user.findUniqueOrThrow({
      where: { id: pedro.user.id },
    });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("el índice parcial rechaza dos invitaciones pending del mismo email", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    await setPlan(h, owner.tenant.id, "PRO");

    // Un email distinto del que ya tiene invitación: si se reutilizara el
    // mismo, los dos rechazos serían correctos pero por la invitación anterior,
    // y el test probaría el `find` en vez del índice parcial.
    const results = await Promise.allSettled([
      h.invitations.create({
        email: "marta@example.com",
        role: "AGENT",
        tenantId: owner.tenant.id,
        invitedBy: owner.user.id,
      invitedByRole: "OWNER",
      }),
      h.invitations.create({
        email: "marta@example.com",
        role: "AGENT",
        tenantId: owner.tenant.id,
        invitedBy: owner.user.id,
      invitedByRole: "OWNER",
      }),
    ]);

    const aceptados = results.filter((r) => r.status === "fulfilled");
    const rechazados = results.filter((r) => r.status === "rejected");

    expect(aceptados).toHaveLength(1);
    expect(rechazados).toHaveLength(1);
    expect(
      (rechazados[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ConflictError);

    const pendientes = await h.prisma.db.invitation.count({
      where: {
        tenantId: owner.tenant.id,
        email: "marta@example.com",
        status: "PENDING",
      },
    });
    expect(pendientes).toBe(1);
  });

  it("dos aceptaciones simultáneas del mismo token: solo una gana", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    const pedro = await register(h, "pedro@example.com", "Pedro Ruiz");
    await setPlan(h, owner.tenant.id, "PRO");

    await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });
    const token = lastInvitationToken(h);

    const results = await Promise.allSettled([
      h.invitations.accept({ token, email: "pedro@example.com" }),
      h.invitations.accept({ token, email: "pedro@example.com" }),
    ]);

    const aceptados = results.filter((r) => r.status === "fulfilled");
    const rechazados = results.filter((r) => r.status === "rejected");

    expect(aceptados).toHaveLength(1);
    expect(rechazados).toHaveLength(1);
    expect(
      (rechazados[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InvalidTokenError);

    // Y no quedó una membresía duplicada por el camino perdedor.
    const memberships = await h.prisma.db.membership.count({
      where: { tenantId: owner.tenant.id, userId: pedro.user.id },
    });
    expect(memberships).toBe(1);

    const invitation = await h.prisma.db.invitation.findFirstOrThrow({
      where: { tenantId: owner.tenant.id, email: "pedro@example.com" },
    });
    expect(invitation.status).toBe("ACCEPTED");
    expect(invitation.acceptedBy).toBe(pedro.user.id);
  });

  it("dos revocaciones simultáneas: solo una gana y la otra recibe 409", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    await setPlan(h, owner.tenant.id, "PRO");

    const created = await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });

    const results = await Promise.allSettled([
      h.invitations.revoke(owner.tenant.id, created.id),
      h.invitations.revoke(owner.tenant.id, created.id),
    ]);

    const rechazados = results.filter((r) => r.status === "rejected");
    expect(rechazados.length).toBeGreaterThanOrEqual(1);
    for (const r of rechazados) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    }

    const invitation = await h.prisma.db.invitation.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(invitation.status).toBe("REVOKED");
  });

  it("rechaza con 409 si el email ya es miembro del tenant", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    await setPlan(h, owner.tenant.id, "PRO");

    await register(h, "pedro@example.com", "Pedro Ruiz");
    await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });
    await h.invitations.accept({
      token: lastInvitationToken(h),
      email: "pedro@example.com",
    });

    // Pedro ya es miembro del tenant de Ana.
    await expect(
      h.invitations.create({
        email: "pedro@example.com",
        role: "AGENT",
        tenantId: owner.tenant.id,
        invitedBy: owner.user.id,
        invitedByRole: "OWNER",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("la expiración perezosa libera el índice parcial de un email", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    await setPlan(h, owner.tenant.id, "PRO");

    const first = await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });

    await h.prisma.db.invitation.update({
      where: { id: first.id },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });

    // Sin la limpieza previa, este `create` reventaría con P2002.
    const second = await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });

    expect(second.status).toBe("PENDING");
    expect(second.id).not.toBe(first.id);

    const vencida = await h.prisma.db.invitation.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(vencida.status).toBe("EXPIRED");
  });

  it("el token vencido se marca EXPIRED y no admite reutilización", async () => {
    const h = await harness();
    const owner = await register(h, "ana@example.com", "Ana Torres");
    const pedro = await register(h, "pedro@example.com", "Pedro Ruiz");
    await setPlan(h, owner.tenant.id, "PRO");

    const created = await h.invitations.create({
      email: "pedro@example.com",
      role: "AGENT",
      tenantId: owner.tenant.id,
      invitedBy: owner.user.id,
      invitedByRole: "OWNER",
    });
    const token = lastInvitationToken(h);
    await h.prisma.db.invitation.update({
      where: { id: created.id },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });

    await expect(
      h.invitations.accept({ token, email: "pedro@example.com" }),
    ).rejects.toBeInstanceOf(InvalidTokenError);

    const invitation = await h.prisma.db.invitation.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(invitation.status).toBe("EXPIRED");
    expect(invitation.acceptedBy).toBeNull();

    const memberships = await h.prisma.db.membership.count({
      where: { tenantId: owner.tenant.id, userId: pedro.user.id },
    });
    expect(memberships).toBe(0);
  });
});
