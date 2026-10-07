import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { api, createTestApp, resetThrottler } from "./helpers/app";
import { closeTestDatabase, resetDatabase, testDatabase } from "./helpers/database";

/**
 * E2E HTTP de M-5: invitaciones y verificación de email.
 *
 * Atraviesa guards, `ValidationPipe`, filtro de errores y PostgreSQL real. Lo
 * que se comprueba aquí y no en los unitarios es exactamente lo que solo puede
 * fallar en el borde HTTP: que el 409 del plan sale por el filtro y no como 500,
 * que el rol degradado en BD corta la creación de invitaciones, y que la sesión
 * devuelta por `accept` sirve para llamar a `/me` con el tenant nuevo.
 */

const PASSWORD = "ContraseñaLarga1!";

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string; plan: string };
  membership: { id: string; role: string; status: string };
}

interface AcceptBody {
  tenantId: string;
  tenantName: string;
  role: string;
  status: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

let app: INestApplication;
let emails: MockEmailAdapter;

function http(): request.Agent {
  return request(app.getHttpServer()) as unknown as request.Agent;
}

function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

async function register(
  email: string,
  name: string,
): Promise<SessionBody> {
  const res = await request(app.getHttpServer())
    .post(api("/auth/register"))
    .send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body as SessionBody;
}

async function login(email: string): Promise<SessionBody> {
  const res = await request(app.getHttpServer())
    .post(api("/auth/login"))
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as SessionBody;
}

/** Último token enviado con el template indicado; `undefined` si no hay ninguno. */
function lastToken(template: "invitation" | "verification"): string | undefined {
  return emails.sent.filter((m) => m.template === template).at(-1)?.token;
}

async function inviteAs(
  session: SessionBody,
  email: string,
  role = "AGENT",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await http()
    .post(api("/invitations"))
    .set(...bearer(session.accessToken))
    .send({ email, role });
  return { status: res.status, body: res.body as Record<string, unknown> };
}

beforeAll(async () => {
  app = await createTestApp();
  emails = app.get(MockEmailAdapter);
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

describe("POST /api/v1/invitations", () => {
  it("crea la invitación y no devuelve el token", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const res = await inviteAs(owner, "pedro@example.com");

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("pedro@example.com");
    expect(res.body.role).toBe("AGENT");
    expect(res.body.status).toBe("PENDING");
    expect(res.body).not.toHaveProperty("token");
    expect(res.body).not.toHaveProperty("tokenHash");
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
    expect(lastToken("invitation")).toBeTruthy();
  });

  it("persiste solo el hash del token en la tabla", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await inviteAs(owner, "pedro@example.com");

    const token = lastToken("invitation") as string;
    const row = await testDatabase().invitation.findFirstOrThrow();

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("exige autenticación", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/invitations"))
      .send({ email: "pedro@example.com", role: "AGENT" });

    expect(res.status).toBe(401);
  });

  it("devuelve 403 si quien invita es AGENT", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const agent = await register("carla@example.com", "Carla Ruiz");
    const invited = await inviteAs(owner, "carla@example.com");
    expect(invited.status).toBe(201);

    // Carla acepta y entra como AGENT; con ese token no puede invitar.
    const accept = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(agent.accessToken))
      .send({ token: lastToken("invitation") });
    expect(accept.status).toBe(200);
    const asAgent = accept.body as AcceptBody;

    const res = await inviteAs(
      { accessToken: asAgent.accessToken } as SessionBody,
      "dani@example.com",
    );

    expect(res.status).toBe(403);
  });

  it("devuelve 409 si el email ya pertenece al tenant", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const res = await inviteAs(owner, "ana@example.com");

    expect(res.status).toBe(409);
  });

  it("devuelve 409 si ya hay una invitación pendiente para el mismo email", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await inviteAs(owner, "pedro@example.com");
    const second = await inviteAs(owner, "pedro@example.com");

    expect(second.status).toBe(409);
  });

  it("devuelve 409 al superar el maxUsers del plan", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");

    // BASIC = 2 usuarios. Ya está el OWNER, así que solo cabe uno más.
    expect((await inviteAs(owner, "pedro@example.com")).status).toBe(201);
    const accept = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token: lastToken("invitation") });
    expect(accept.status).toBe(200);

    const res = await inviteAs(owner, "dani@example.com");
    expect(res.status).toBe(409);
  });

  it("devuelve 400 si el body no cumple el contrato", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const res = await http()
      .post(api("/invitations"))
      .set(...bearer(owner.accessToken))
      .send({ email: "no-es-un-email", role: "SUPERADMIN" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

describe("POST /api/v1/invitations/accept", () => {
  it("crea la membresía, verifica el email y devuelve sesión del tenant invitado", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");
    await inviteAs(owner, "pedro@example.com", "ADMIN");

    const res = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token: lastToken("invitation") });

    expect(res.status).toBe(200);
    const body = res.body as AcceptBody;
    expect(body.tenantId).toBe(owner.tenant.id);
    expect(body.tenantName).toBe(owner.tenant.name);
    expect(body.role).toBe("ADMIN");
    expect(body.status).toBe("ACTIVE");
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    // La sesión devuelta es del tenant invitado, no del propio de Pedro.
    const me = await http().get(api("/me")).set(...bearer(body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.currentTenant.id).toBe(owner.tenant.id);
    expect(me.body.membership.role).toBe("ADMIN");

    // Y el email quedó verificado sin pasar por `POST /email-verification/verify`.
    const db = testDatabase();
    const user = await db.user.findUniqueOrThrow({ where: { id: pedro.user.id } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it("exige autenticación", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await inviteAs(owner, "pedro@example.com");

    const res = await request(app.getHttpServer())
      .post(api("/invitations/accept"))
      .send({ token: lastToken("invitation") });

    expect(res.status).toBe(401);
  });

  it("devuelve 400 invalid_token si el token es de otro email", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await register("pedro@example.com", "Pedro Ruiz");
    await register("malo@example.com", "Mal Ruina");
    // Sesión reanudada con `login`, no la devuelta por `register`: es el camino
    // real del invitado, que vuelve a la app días después de registrarse.
    const malo = await login("malo@example.com");
    await inviteAs(owner, "pedro@example.com");
    const token = lastToken("invitation");

    const res = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(malo.accessToken))
      .send({ token });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");

    // La invitación sobrevive: un intento fallido no la gasta.
    const row = await testDatabase().invitation.findFirstOrThrow();
    expect(row.status).toBe("PENDING");
  });

  it("devuelve 400 invalid_token con un token inexistente", async () => {
    const pedro = await register("pedro@example.com", "Pedro Ruiz");

    const res = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token: "inventado" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");
  });

  it("no acepta dos veces la misma invitación", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");
    await inviteAs(owner, "pedro@example.com");
    const token = lastToken("invitation");

    const first = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token });
    expect(first.status).toBe(200);

    const second = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("invalid_token");

    const memberships = await testDatabase().membership.count({
      where: { userId: pedro.user.id, tenantId: owner.tenant.id },
    });
    expect(memberships).toBe(1);
  });

  it("devuelve 400 invalid_token si la invitación venció", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await register("pedro@example.com", "Pedro Ruiz");
    const pedro = await login("pedro@example.com");
    await inviteAs(owner, "pedro@example.com");

    await testDatabase().invitation.updateMany({
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });

    const res = await http()
      .post(api("/invitations/accept"))
      .set(...bearer(pedro.accessToken))
      .send({ token: lastToken("invitation") });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");

    const row = await testDatabase().invitation.findFirstOrThrow();
    expect(row.status).toBe("EXPIRED");
  });
});

describe("DELETE /api/v1/invitations/:id", () => {
  it("revoca la invitación pendiente y devuelve 204", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const created = await inviteAs(owner, "pedro@example.com");

    const res = await http()
      .delete(`${api("/invitations")}/${String(created.body.id)}`)
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    const row = await testDatabase().invitation.findFirstOrThrow();
    expect(row.status).toBe("REVOKED");
    expect(row.revokedAt).not.toBeNull();
  });

  it("devuelve 404 si la invitación es de otro tenant", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const created = await inviteAs(owner, "pedro@example.com");
    const otro = await register("otro@example.com", "Otro Dueño");

    const res = await http()
      .delete(`${api("/invitations")}/${String(created.body.id)}`)
      .set(...bearer(otro.accessToken));

    expect(res.status).toBe(404);

    const row = await testDatabase().invitation.findFirstOrThrow();
    expect(row.status).toBe("PENDING");
  });

  it("devuelve 404 si el id no existe", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .delete(
        `${api("/invitations")}/00000000-0000-4000-8000-000000000000`,
      )
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(404);
  });

  it("devuelve 400 si el id no es un UUID", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .delete(`${api("/invitations")}/no-es-uuid`)
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("devuelve 409 si la invitación ya no está pendiente", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const created = await inviteAs(owner, "pedro@example.com");
    await testDatabase().invitation.updateMany({ data: { status: "EXPIRED" } });

    const res = await http()
      .delete(`${api("/invitations")}/${String(created.body.id)}`)
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(409);
  });

  it("exige autenticación", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const created = await inviteAs(owner, "pedro@example.com");

    const res = await request(app.getHttpServer()).delete(
      `${api("/invitations")}/${String(created.body.id)}`,
    );

    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/email-verification/verify", () => {
  it("verifica el email con el token recibido en el registro", async () => {
    const user = await register("ana@example.com", "Ana Torres");
    const token = lastToken("verification");

    const res = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.emailVerifiedAt).toBeTruthy();

    const row = await testDatabase().user.findUniqueOrThrow({
      where: { id: user.user.id },
    });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("no reutiliza un token ya usado", async () => {
    const user = await register("ana@example.com", "Ana Torres");
    const token = lastToken("verification");

    const first = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token });
    expect(first.status).toBe(200);

    const second = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token });

    expect(second.status).toBe(400);
    expect(second.body.code).toBe("invalid_token");
  });

  it("devuelve 400 invalid_token con un token inventado", async () => {
    const user = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token: "inventado" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");
  });

  it("devuelve 400 invalid_token si el token venció, y lo consume", async () => {
    const user = await register("ana@example.com", "Ana Torres");
    await testDatabase().verificationToken.updateMany({
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });

    const res = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token: lastToken("verification") });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");

    const row = await testDatabase().verificationToken.findFirstOrThrow();
    expect(row.usedAt).not.toBeNull();

    const dbUser = await testDatabase().user.findUniqueOrThrow({
      where: { id: user.user.id },
    });
    expect(dbUser.emailVerifiedAt).toBeNull();
  });

  it("exige autenticación", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/email-verification/verify"))
      .send({ token: "cualquiera" });

    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/email-verification/resend", () => {
  it("reenvía y deja el token anterior invalidado", async () => {
    const user = await register("ana@example.com", "Ana Torres");
    const primer = lastToken("verification");

    const res = await http()
      .post(api("/email-verification/resend"))
      .set(...bearer(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);

    const segundo = lastToken("verification");
    expect(segundo).toBeTruthy();
    expect(segundo).not.toBe(primer);

    // El email nuevo sirve; el viejo ya no.
    const nuevo = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token: segundo });
    expect(nuevo.status).toBe(200);

    const viejo = await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token: primer });
    expect(viejo.status).toBe(400);
    expect(viejo.body.code).toBe("invalid_token");
  });

  it("no envía nada si el email ya está verificado", async () => {
    const user = await register("ana@example.com", "Ana Torres");
    await http()
      .post(api("/email-verification/verify"))
      .set(...bearer(user.accessToken))
      .send({ token: lastToken("verification") });

    emails.clear();

    const res = await http()
      .post(api("/email-verification/resend"))
      .set(...bearer(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(emails.sent).toHaveLength(0);
  });

  it("exige autenticación", async () => {
    const res = await request(app.getHttpServer()).post(
      api("/email-verification/resend"),
    );

    expect(res.status).toBe(401);
  });

  it("devuelve 429 al superar el rate limit de reenvíos", async () => {
    const user = await register("ana@example.com", "Ana Torres");

    // El límite declarado es 5 por 15 min: el sexto intento debe rebotar.
    for (let i = 0; i < 5; i += 1) {
      const res = await http()
        .post(api("/email-verification/resend"))
        .set(...bearer(user.accessToken));
      expect(res.status).toBe(200);
    }

    const res = await http()
      .post(api("/email-verification/resend"))
      .set(...bearer(user.accessToken));

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("rate_limited");
  });
});
