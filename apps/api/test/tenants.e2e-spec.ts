import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { api, createTestApp, resetThrottler } from "./helpers/app";
import {
  closeTestDatabase,
  resetDatabase,
  testDatabase,
} from "./helpers/database";

/**
 * E2E HTTP de tenants y usuarios (docs/api/authentication.md §9–§10).
 *
 * Atraviesa la cadena de guards (JWT → TenantContextGuard → RolesGuard), el
 * `ValidationPipe`, el filtro de errores y PostgreSQL real. Lo que se prueba en
 * el borde HTTP y no en los otros niveles:
 *
 *  - Que el `:tenantId` ajeno da 404 (indistinguible de "no existe") y 403
 *    nunca, para no revelar tenants.
 *  - Que `PATCH /current` es OWNER-only y que los campos que no toca el
 *    inquilino (`plan`) se rechazan en el pipe.
 *  - Que un ADMIN ve 403 al tocar al OWNER y que el 409 del último OWNER sale
 *    con código `conflict`, no como 500.
 */
const PASSWORD = "ContraseñaLarga1!";

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string; plan: string; status: string };
  membership: { id: string; role: string; status: string };
}

interface AcceptBody {
  tenantId: string;
  tenantName: string;
  role: string;
  status: string;
  accessToken: string;
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

function lastInviteToken(): string {
  const token = emails.sent.filter((m) => m.template === "invitation").at(-1)?.token;
  if (!token) {
    throw new Error("no hay token de invitación capturado");
  }
  return token;
}

/** Añade a un usuario registrado como miembro del tenant vía invitación. */
async function addMemberAs(
  owner: SessionBody,
  target: SessionBody,
  role: "ADMIN" | "AGENT" = "AGENT",
): Promise<SessionBody> {
  const invite = await http()
    .post(api("/invitations"))
    .set(...bearer(owner.accessToken))
    .send({ email: target.user.email, role });
  expect(invite.status).toBe(201);

  const accept = await http()
    .post(api("/invitations/accept"))
    .set(...bearer(target.accessToken))
    .send({ token: lastInviteToken() });
  expect(accept.status).toBe(200);

  return { ...target, ...(accept.body as AcceptBody) };
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

describe("GET /api/v1/tenants/current", () => {
  it("devuelve los metadatos del tenant del access token", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .get(api("/tenants/current"))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: owner.tenant.id,
      slug: owner.tenant.slug,
      name: owner.tenant.name,
      plan: owner.tenant.plan,
      status: "ACTIVE",
    });
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("exige autenticación", async () => {
    const res = await http().get(api("/tenants/current"));
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/v1/tenants/current", () => {
  it("OWNER edita name y slug", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .patch(api("/tenants/current"))
      .set(...bearer(owner.accessToken))
      .send({ name: "Café de Ana", slug: "cafe-de-ana" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Café de Ana");
    expect(res.body.slug).toBe("cafe-de-ana");

    const row = await testDatabase().tenant.findUniqueOrThrow({
      where: { id: owner.tenant.id },
    });
    expect(row.slug).toBe("cafe-de-ana");
  });

  it("slug no normalizado → 400 (el cliente manda el slug ya normalizado)", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .patch(api("/tenants/current"))
      .set(...bearer(owner.accessToken))
      .send({ slug: "Café de Ana" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("rechaza a un ADMIN (403)", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const admin = await register("carla@example.com", "Carla Ruiz");
    const asAdmin = await addMemberAs(owner, admin, "ADMIN");
    expect(asAdmin.role).toBe("ADMIN");

    const res = await http()
      .patch(api("/tenants/current"))
      .set(...bearer(asAdmin.accessToken))
      .send({ name: "Tocado por Carla" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("slug ocupado por otro tenant → 409", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    await register("otra@example.com", "Otra Empresa");
    await testDatabase().tenant.update({
      where: { slug: "otra-empresa" },
      data: { slug: "cafe-ya-tomado" },
    });

    const res = await http()
      .patch(api("/tenants/current"))
      .set(...bearer(owner.accessToken))
      .send({ slug: "cafe-ya-tomado" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("conflict");
  });

  it("no acepta campos fuera del contrato (plan) → 400", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .patch(api("/tenants/current"))
      .set(...bearer(owner.accessToken))
      .send({ name: "Café", plan: "PREMIUM" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

describe("GET /api/v1/tenants/:tenantId/users", () => {
  it("OWNER ve la lista de sus miembros", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");
    await addMemberAs(owner, pedro);

    const res = await http()
      .get(api(`/tenants/${owner.tenant.id}/users`))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pedro.user.id, email: pedro.user.email }),
      ]),
    );
    for (const item of items) {
      expect(item).not.toHaveProperty("passwordHash");
    }
  });

  it("un AGENT también puede listar (cualquier miembro activo)", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const agent = await register("pedro@example.com", "Pedro Ruiz");
    const asAgent = await addMemberAs(owner, agent);

    const res = await http()
      .get(api(`/tenants/${owner.tenant.id}/users`))
      .set(...bearer(asAgent.accessToken));

    expect(res.status).toBe(200);
  });

  it(":tenantId de otro tenant → 404, nunca 403", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const other = await register("carla@example.com", "Carla Ruiz");

    const res = await http()
      .get(api(`/tenants/${other.tenant.id}/users`))
      .set(...bearer(owner.accessToken));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });
});

describe("PATCH /api/v1/tenants/:tenantId/users/:userId", () => {
  it("OWNER promueve a un AGENT", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");
    await addMemberAs(owner, pedro);

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${pedro.user.id}`))
      .set(...bearer(owner.accessToken))
      .send({ role: "ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: pedro.user.id,
      role: "ADMIN",
      status: "ACTIVE",
    });
  });

  it("ADMIN gestiona a un AGENT (mismo nivel de equipo)", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const admin = await register("carla@example.com", "Carla Ruiz");
    const asAdmin = await addMemberAs(owner, admin, "ADMIN");
    const agente = await register("dani@example.com", "Dani Vega");

    // BASIC = 2 miembros; este caso necesita 3, así que el tenant pasa a PRO.
    await testDatabase().tenant.update({
      where: { id: owner.tenant.id },
      data: { plan: "PRO" },
    });
    await addMemberAs(owner, agente);

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${agente.user.id}`))
      .set(...bearer(asAdmin.accessToken))
      .send({ status: "INACTIVE" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: agente.user.id, status: "INACTIVE" });
  });

  it("ADMIN no puede tocar a un OWNER → 403", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const admin = await register("carla@example.com", "Carla Ruiz");
    const asAdmin = await addMemberAs(owner, admin, "ADMIN");

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${owner.user.id}`))
      .set(...bearer(asAdmin.accessToken))
      .send({ role: "AGENT" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("único OWNER degradándose → 409", async () => {
    const owner = await register("ana@example.com", "Ana Torres");

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${owner.user.id}`))
      .set(...bearer(owner.accessToken))
      .send({ role: "AGENT" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("conflict");
  });

  it("OWNER degrada a un segundo OWNER y queda uno", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const socio = await register("socio@example.com", "Socia Ruiz");
    await addMemberAs(owner, socio, "OWNER");

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${socio.user.id}`))
      .set(...bearer(owner.accessToken))
      .send({ role: "AGENT" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("AGENT");
  });

  it("usuario de otro tenant → 404 user_not_found", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const other = await register("carla@example.com", "Carla Ruiz");

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${other.user.id}`))
      .set(...bearer(owner.accessToken))
      .send({ role: "AGENT" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("user_not_found");
  });

  it("body con rol inválido → 400", async () => {
    const owner = await register("ana@example.com", "Ana Torres");
    const pedro = await register("pedro@example.com", "Pedro Ruiz");
    await addMemberAs(owner, pedro);

    const res = await http()
      .patch(api(`/tenants/${owner.tenant.id}/users/${pedro.user.id}`))
      .set(...bearer(owner.accessToken))
      .send({ role: "SUPERADMIN" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});