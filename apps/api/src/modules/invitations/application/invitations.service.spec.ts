import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, InvalidTokenError, NotFoundError } from "../../../domain/errors";
import type { EmailSender } from "../../../domain/ports/email-sender";
import type { TokenHasher } from "../../../domain/ports/token-hasher";
import { LimitsService } from "../../../domain/plans/limits-service";
import {
  createInMemoryScope,
  InMemoryUnitOfWork,
  makeInvitation,
  makeMembership,
  makeTenant,
  makeUser,
  type InMemoryScope,
} from "../../../testing/in-memory/fakes";
import { AuthConfigService } from "../../auth/application/auth-config.service";
import { SessionService } from "../../auth/application/session.service";
import { InvitationsService } from "./invitations.service";
import { toInvitationDto } from "../presentation/invitation.mapper";

/**
 * Reloj congelado solo para `SessionService`; `InvitationsService` decide
 * expiraciones con `new Date()` (reloj real), así que las fechas de los fixtures
 * tienen que ser inequívocamente futuras o pasadas en lugar de "cercanas":
 * un `expiresAt` a 24 h del día de ejecución pasó a ser vencido a medianoche y
 * dejó un test verde que en realidad ejercitaba la expiración perezosa.
 */
const NOW = new Date("2026-09-29T12:00:00.000Z");
/** Lejos en el futuro: una invitación sembrada con esto está viva siempre. */
const ALIVE = new Date("2099-01-01T00:00:00.000Z");
/** Lejos en el pasado: siempre vencida. */
const PAST = new Date("2000-01-01T00:00:00.000Z");

/** Hash hasher de mentira, **síncrono** como `Sha256TokenHasher`. */
class FakeTokenHasher implements TokenHasher {
  hashToken(token: string): string {
    return `sha256$${token}`;
  }
}

class RecordingEmailSender implements EmailSender {
  readonly messages: Parameters<EmailSender["send"]>[0][] = [];

  async send(message: Parameters<EmailSender["send"]>[0]): Promise<void> {
    this.messages.push(message);
  }
}

function buildHarness(): {
  service: InvitationsService;
  scope: InMemoryScope;
  emailSender: RecordingEmailSender;
  tokens: () => string[];
} {
  const scope = createInMemoryScope();
  const unitOfWork = new InMemoryUnitOfWork(scope);
  const emailSender = new RecordingEmailSender();
  const hasher = new FakeTokenHasher();

  const config = {
    now: () => NOW,
    accessTtlSeconds: 900,
    refreshTtlSeconds: 2_592_000,
    jwtSecret: "x".repeat(32),
    issuer: "negocia-api",
    audience: "negocia-clients",
    argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 },
    freezeClock: () => undefined,
  } as unknown as AuthConfigService;

  let counter = 0;
  const opaqueTokens = { generate: () => `opaque-${(counter += 1)}` };
  let idCounter = 0;
  const ids = { next: () => `id-${(idCounter += 1)}` };
  const accessTokenIssuer = {
    issue: async (input: { sessionId: string; userId: string }) => ({
      accessToken: `jwt.${input.userId}.${input.sessionId}`,
      expiresIn: 900,
    }),
  };

  const sessions = new SessionService(
    unitOfWork,
    accessTokenIssuer as never,
    opaqueTokens,
    hasher,
    ids,
    config,
  );

  const service = new InvitationsService(
    unitOfWork,
    scope.invitations,
    scope.memberships,
    scope.users,
    opaqueTokens,
    hasher,
    emailSender,
    new LimitsService(),
    sessions,
  );

  return {
    service,
    scope,
    emailSender,
    // `EmailMessage.token` es opcional, pero los mensajes que estos tests
    // producen siempre lo traen. El filtro deja el tipo en `string[]` sin
    // sembrar el archivo de `as string`.
    tokens: () =>
      emailSender.messages
        .map((m) => m.token)
        .filter((t): t is string => typeof t === "string"),
  };
}

/** Deja el tenant con su OWNER y, opcionalmente, extra activo. */
function seedTenant(
  scope: InMemoryScope,
  plan: "BASIC" | "PRO" | "PREMIUM" = "BASIC",
): void {
  scope.tenants.rows.push(makeTenant({ plan }));
  scope.users.rows.push(makeUser({ id: "owner-1", email: "owner@example.com" }));
  scope.memberships.rows.push(
    makeMembership({ id: "mem-owner", userId: "owner-1", role: "OWNER" }),
  );
}

describe("InvitationsService.create", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    seedTenant(harness.scope);
  });

  it("crea la invitación, normaliza el email y envía el token por email", async () => {
    const invitation = await harness.service.create({
      email: "  Nuevo@Example.COM ",
      role: "AGENT",
      tenantId: "tenant-1",
      invitedBy: "owner-1",
      invitedByRole: "OWNER",
    });

    expect(invitation.email).toBe("nuevo@example.com");
    expect(invitation.status).toBe("PENDING");
    expect(invitation.role).toBe("AGENT");
    expect(invitation.invitedBy).toBe("owner-1");
    expect(harness.emailSender.messages).toHaveLength(1);
    expect(harness.emailSender.messages[0]?.template).toBe("invitation");
    expect(harness.emailSender.messages[0]?.to).toBe("nuevo@example.com");
  });

  it("nunca persiste el token en crudo y el DTO no expone ni el token ni su hash", async () => {
    const record = await harness.service.create({
      email: "nuevo@example.com",
      role: "AGENT",
      tenantId: "tenant-1",
      invitedBy: "owner-1",
      invitedByRole: "OWNER",
    });

    const [raw] = harness.tokens();
    expect(raw).toBeTruthy();

    // En la tabla solo vive el hash.
    expect(harness.scope.invitations.rows[0]?.tokenHash).toBe(`sha256$${raw}`);

    // Y lo que sale por HTTP no lleva ni `token` ni `tokenHash`. La aserción es
    // sobre el DTO, no sobre la entidad: la entidad sí contiene `tokenHash` a
    // propósito, y comprobarla ahí no probaría nada del borde HTTP.
    const dto = toInvitationDto(record);
    expect(dto).not.toHaveProperty("token");
    expect(dto).not.toHaveProperty("tokenHash");
    expect(Object.keys(dto)).not.toContain("tokenHash");
  });

  it("rechaza con 409 si el email ya es miembro del tenant", async () => {
    harness.scope.users.rows.push(makeUser({ id: "user-2", email: "ya@inside.com" }));
    harness.scope.memberships.rows.push(
      makeMembership({ id: "mem-2", userId: "user-2", role: "AGENT" }),
    );

    await expect(
      harness.service.create({
        email: "ya@inside.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(harness.scope.invitations.rows).toHaveLength(0);
  });

  it("rechaza con 409 si ya hay una invitación pendiente para ese email", async () => {
    harness.scope.invitations.rows.push(
      makeInvitation({
        email: "pendiente@example.com",
        tokenHash: "otro",
        expiresAt: ALIVE,
      }),
    );

    await expect(
      harness.service.create({
        email: "pendiente@example.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rechaza con 409 al superar maxUsers del plan", async () => {
    // BASIC = 2 usuarios y ya hay 1 OWNER: solo cabe un invitado más.
    await expect(
      harness.service.create({
        email: "a@example.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      }),
    ).resolves.toBeDefined();

    harness.scope.users.rows.push(makeUser({ id: "user-9", email: "ocupa@plan.com" }));
    harness.scope.memberships.rows.push(
      makeMembership({ id: "mem-9", userId: "user-9", role: "AGENT" }),
    );

    await expect(
      harness.service.create({
        email: "b@example.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

it("devuelve 404 si el tenant no existe", async () => {
    await expect(
      harness.service.create({
        email: "nuevo@example.com",
        role: "AGENT",
        tenantId: "tenant-inexistente",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("InvitationsService.create: matriz de roles (canInviteRole)", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    seedTenant(harness.scope, "PRO");
  });

  it("un OWNER puede invitar a OWNER, ADMIN y AGENT (sucesión)", async () => {
    for (const role of ["OWNER", "ADMIN", "AGENT"] as const) {
      const invitation = await harness.service.create({
        email: `own-${role.toLowerCase()}@example.com`,
        role,
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "OWNER",
      });
      expect(invitation.role).toBe(role);
    }
    expect(harness.scope.invitations.rows).toHaveLength(3);
  });

  it("un ADMIN invita a ADMIN y AGENT, pero no a OWNER", async () => {
    await expect(
      harness.service.create({
        email: "admin@example.com",
        role: "ADMIN",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "ADMIN",
      }),
    ).resolves.toBeDefined();

    await expect(
      harness.service.create({
        email: "agent@example.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "ADMIN",
      }),
    ).resolves.toBeDefined();

    await expect(
      harness.service.create({
        email: "usurpador@example.com",
        role: "OWNER",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Nada con rol OWNER quedó persistido por el ADMIN.
    expect(
      harness.scope.invitations.rows.some((row) => row.role === "OWNER"),
    ).toBe(false);
  });

  it("un AGENT no puede invitar a nadie (fail-closed)", async () => {
    await expect(
      harness.service.create({
        email: "cualquiera@example.com",
        role: "AGENT",
        tenantId: "tenant-1",
        invitedBy: "owner-1",
        invitedByRole: "AGENT",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(harness.scope.invitations.rows).toHaveLength(0);
  });
});

describe("InvitationsService.accept", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    seedTenant(harness.scope, "PRO");
    harness.scope.users.rows.push(
      makeUser({ id: "user-2", email: "invitado@example.com" }),
    );
  });

  async function invite(): Promise<string> {
    await harness.service.create({
      email: "invitado@example.com",
      role: "AGENT",
      tenantId: "tenant-1",
      invitedBy: "owner-1",
      invitedByRole: "OWNER",
    });
    return harness.tokens()[0] as string;
  }

  it("consume el token, crea la membresía, verifica el email y emite sesión", async () => {
    const token = await invite();

    const result = await harness.service.accept({
      token,
      email: "invitado@example.com",
    });

    expect(result.tenantId).toBe("tenant-1");
    expect(result.role).toBe("AGENT");
    expect(result.status).toBe("ACTIVE");
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    const membership = harness.scope.memberships.rows.find(
      (row) => row.userId === "user-2",
    );
    expect(membership).toBeDefined();
    expect(membership?.status).toBe("ACTIVE");

    const user = harness.scope.users.rows.find((row) => row.id === "user-2");
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("deja la invitación en ACCEPTED con acceptedBy", async () => {
    const token = await invite();
    await harness.service.accept({ token, email: "invitado@example.com" });

    const invitation = harness.scope.invitations.rows[0];
    expect(invitation?.status).toBe("ACCEPTED");
    expect(invitation?.acceptedBy).toBe("user-2");
    expect(invitation?.acceptedAt).toBeInstanceOf(Date);
  });

  it("es de un solo uso: el segundo intento falla con invalid_token", async () => {
    const token = await invite();
    await harness.service.accept({ token, email: "invitado@example.com" });

    await expect(
      harness.service.accept({ token, email: "invitado@example.com" }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    // Y no duplica la membresía.
    expect(
      harness.scope.memberships.rows.filter((row) => row.userId === "user-2"),
    ).toHaveLength(1);
  });

  it("rechaza si el token es de otro email", async () => {
    const token = await invite();

    await expect(
      harness.service.accept({ token, email: "otro@example.com" }),
    ).rejects.toBeInstanceOf(InvalidTokenError);

    // La invitación sobrevive intacta: el atacante no debe poder gastarla.
    expect(harness.scope.invitations.rows[0]?.status).toBe("PENDING");
  });

  it("rechaza y marca EXPIRED si el token venció", async () => {
    await invite();
    harness.scope.invitations.rows[0]!.expiresAt = PAST;

    await expect(
      harness.service.accept({
        token: harness.tokens()[0] as string,
        email: "invitado@example.com",
      }),
    ).rejects.toBeInstanceOf(InvalidTokenError);

    expect(harness.scope.invitations.rows[0]?.status).toBe("EXPIRED");
    expect(
      harness.scope.memberships.rows.filter((row) => row.userId === "user-2"),
    ).toHaveLength(0);
  });

  it("rechaza con invalid_token si el usuario no existe o está inactivo", async () => {
    const token = await invite();
    harness.scope.users.rows.find((row) => row.id === "user-2")!.status = "SUSPENDED";

    await expect(
      harness.service.accept({ token, email: "invitado@example.com" }),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("revalida maxUsers en el momento del accept, no solo al invitar", async () => {
    const token = await invite();

    // El plan baja a BASIC (2 usuarios) y entra un segundo miembro mientras el
    // token está en el buzón: el accept debe Respectar el límite vigente.
    harness.scope.tenants.rows[0]!.plan = "BASIC";
    harness.scope.users.rows.push(makeUser({ id: "user-3", email: "colado@plan.com" }));
    harness.scope.memberships.rows.push(
      makeMembership({ id: "mem-3", userId: "user-3", role: "AGENT" }),
    );

    await expect(
      harness.service.accept({ token, email: "invitado@example.com" }),
    ).rejects.toBeInstanceOf(ConflictError);

    // La invitación no se consume: el rollback deshace cualquier cambio.
    expect(harness.scope.invitations.rows[0]?.status).toBe("PENDING");
  });
});

describe("InvitationsService.revoke", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
    seedTenant(harness.scope, "PRO");
  });

  it("revoca una invitación pendiente del tenant activo", async () => {
    await harness.service.create({
      email: "invitado@example.com",
      role: "AGENT",
      tenantId: "tenant-1",
      invitedBy: "owner-1",
      invitedByRole: "OWNER",
    });

    await harness.service.revoke("tenant-1", "inv-1");
    expect(harness.scope.invitations.rows[0]?.status).toBe("REVOKED");
    expect(harness.scope.invitations.rows[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("devuelve 404 (no 403) si la invitación es de otro tenant", async () => {
    harness.scope.invitations.rows.push(
      makeInvitation({ id: "inv-otro", tenantId: "tenant-2" }),
    );

    await expect(harness.service.revoke("tenant-1", "inv-otro")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("devuelve 404 si la invitación no existe", async () => {
    await expect(harness.service.revoke("tenant-1", "no-existe")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("devuelve 409 si la invitación ya no está pendiente", async () => {
    harness.scope.invitations.rows.push(
      makeInvitation({ id: "inv-ok", status: "ACCEPTED", expiresAt: ALIVE }),
    );

    await expect(harness.service.revoke("tenant-1", "inv-ok")).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("falla con 409 si otra request revocó la invitación entre el read y el write", async () => {
    // El doble de `revoke` simula la carrera: el `findById` ve PENDING y el
    // `updateMany` condicional devuelve `false` porque ya no lo está.
    harness.scope.invitations.rows.push(makeInvitation({ id: "inv-carrera", expiresAt: ALIVE }));
    const original = harness.scope.invitations.revoke.bind(
      harness.scope.invitations,
    );
    harness.scope.invitations.revoke = async (id: string, at: Date) => {
      harness.scope.invitations.rows[0]!.status = "REVOKED";
      return original(id, at);
    };

    await expect(
      harness.service.revoke("tenant-1", "inv-carrera"),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("InvitationsService.create: expiración perezosa", () => {
  it("libera el hueco de una invitación vencida antes de invitar de nuevo", async () => {
    const harness = buildHarness();
    seedTenant(harness.scope, "PRO");

    harness.scope.invitations.rows.push(
      makeInvitation({
        id: "inv-vencida",
        email: "reincidente@example.com",
        tokenHash: "viejo",
        expiresAt: PAST,
      }),
    );

    await harness.service.create({
      email: "reincidente@example.com",
      role: "AGENT",
      tenantId: "tenant-1",
      invitedBy: "owner-1",
      invitedByRole: "OWNER",
    });

    expect(harness.scope.invitations.rows[0]?.status).toBe("EXPIRED");
    expect(harness.scope.invitations.rows).toHaveLength(2);
    expect(harness.scope.invitations.rows[1]?.status).toBe("PENDING");
  });
});
