import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { api, createTestApp, resetThrottler } from "./helpers/app";
import { closeTestDatabase, resetDatabase } from "./helpers/database";

/**
 * E2E HTTP de M-4 (Supertest contra la aplicación real).
 *
 * A diferencia de los unitarios, aquí se atraviesa **todo** el stack: `main`
 * replicado, `ValidationPipe`, cadena de guards globales, filtro de errores y
 * PostgreSQL. Por eso se comprueban cosas imposibles de simular — que una ruta
 * sin `Authorization` da 401, que un rol degradado en BD surte efecto
 * inmediato, o que el cuerpo de un 429 es el contrato de error compartido.
 */

const PASSWORD = "ContraseñaLarga1!";

interface RegisterBody {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
  user: { id: string; email: string; name: string };
  tenant: { id: string; slug: string; name: string; plan: string };
  membership: { id: string; role: string; status: string };
}

let app: INestApplication;
let emails: MockEmailAdapter;

/**
 * Atajo de lectura para las peticiones autenticadas: reutiliza el mismo
 * objeto `request` que el resto de helpers en vez de crear uno nuevo por
 * llamada, que es lo que ya hace supertest por debajo.
 */
function http(): request.Agent {
  return request(app.getHttpServer()) as unknown as request.Agent;
}

async function register(
  email = "ana@example.com",
  name = "Ana Torres",
): Promise<RegisterBody> {
  const res = await request(app.getHttpServer())
    .post(api("/auth/register"))
    .send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body as RegisterBody;
}

async function login(
  email = "ana@example.com",
): Promise<RegisterBody> {
  const res = await request(app.getHttpServer())
    .post(api("/auth/login"))
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body as RegisterBody;
}

function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
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

describe("POST /api/v1/auth/register", () => {
  it("crea la cuenta y devuelve 201 con la sesión inicial", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({ name: "Ana Torres", email: "ana@example.com", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("ana@example.com");
    expect(res.body.tenant.slug).toBe("ana-torres");
    expect(res.body.membership.role).toBe("OWNER");
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.expiresIn).toBeGreaterThan(0);
  });

  it("normaliza el email y nunca devuelve el hash de la contraseña", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({ name: "Ana", email: "  Ana@Example.COM ", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("ana@example.com");
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(res.body)).not.toContain("argon2");
  });

  it("devuelve 400 si el body no cumple el contrato", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({ name: "Ana", email: "no-es-un-email", password: "corta" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });

  it("devuelve 400 ante campos desconocidos (whitelist estricta)", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({
        name: "Ana",
        email: "ana@example.com",
        password: PASSWORD,
        role: "OWNER",
      });

    // Aceptar `role` en el alta sería una escalada de privilegios directa.
    expect(res.status).toBe(400);
  });

  it("devuelve 409 si el email ya está registrado", async () => {
    await register();
    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({ name: "Otra", email: "ana@example.com", password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("email_already_registered");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("devuelve 200 con tokens nuevos", async () => {
    await register();
    const res = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "ana@example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it("responde igual con email inexistente y con contraseña incorrecta", async () => {
    await register();

    const inexistente = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "nadie@example.com", password: PASSWORD });
    const mala = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "ana@example.com", password: "OtraClave1!" });

    expect(inexistente.status).toBe(401);
    expect(mala.status).toBe(401);
    // Mismo código y mismo mensaje: sin ellos, el endpoint sería un oráculo
    // de enumeración de cuentas.
    expect(inexistente.body.code).toBe("invalid_credentials");
    expect(mala.body.code).toBe("invalid_credentials");
    expect(inexistente.body.message).toBe(mala.body.message);
  });

  it("devuelve 403 si la cuenta está deshabilitada", async () => {
    const session = await register();
    await disableUser(session.user.id);

    const res = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "ana@example.com", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("account_disabled");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rota los tokens y devuelve 200", async () => {
    const session = await register();

    const res = await request(app.getHttpServer())
      .post(api("/auth/refresh"))
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(session.refreshToken);
    expect(res.body.sessionId).toBe(session.sessionId);
  });

  it("devuelve 401 `reuse_detected` al reutilizar el token rotado", async () => {
    const session = await register();
    await request(app.getHttpServer())
      .post(api("/auth/refresh"))
      .send({ refreshToken: session.refreshToken });

    const res = await request(app.getHttpServer())
      .post(api("/auth/refresh"))
      .send({ refreshToken: session.refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("reuse_detected");
  });

  it("devuelve 400 si falta el refreshToken", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/refresh"))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

describe("GET /api/v1/me", () => {
  it("devuelve el principal y la lista de tenants", async () => {
    const session = await register();

    const res = await http()
      .get(api("/me"))
      .set(...bearer(session.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("ana@example.com");
    expect(res.body.currentTenant.id).toBe(session.tenant.id);
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0].role).toBe("OWNER");
  });

  it("devuelve 401 sin Authorization", async () => {
    const res = await http().get(api("/me"));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_credentials");
  });

  it("devuelve 401 con un token con firma inválida", async () => {
    const session = await register();
    const [, token] = session.accessToken.split(".");
    const forjado = `eyJhbGciOiJIUzI1NiJ9.${token}.firma-inventada`;

    const res = await http()
      .get(api("/me"))
      .set("Authorization", `Bearer ${forjado}`);

    expect(res.status).toBe(401);
  });

  /**
   * El claim `tenant_id` del JWT es una **pista**, no una autoridad: si el
   * tenant se suspende, el siguiente request falla aunque el token siga
   * dentro de su ventana de validez.
   */
  it("suspender el tenant invalida el acceso en el request siguiente", async () => {
    const session = await register();
    await setTenantStatus(session.tenant.id, "SUSPENDED");

    const res = await http()
      .get(api("/me"))
      .set(...bearer(session.accessToken));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_inactive");
  });

  it("degradar el rol en BD surte efecto sin esperar al vencimiento del token", async () => {
    const session = await register();
    await setMembershipRole(session.membership.id, "AGENT");

    const res = await http()
      .get(api("/me"))
      .set(...bearer(session.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.membership.role).toBe("AGENT");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("devuelve 204 y revoca la familia", async () => {
    const session = await register();

    const res = await http()
      .post(api("/auth/logout"))
      .set(...bearer(session.accessToken))
      .send({});

    expect(res.status).toBe(204);

    // El refresh ya no sirve: la familia quedó cerrada.
    const refresh = await http()
      .post(api("/auth/refresh"))
      .send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("exige autenticación aunque el body no la pida", async () => {
    const res = await http().post(api("/auth/logout")).send({});

    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/auth/revoke-all", () => {
  it("cierra todas las sesiones del usuario", async () => {
    const session = await register();
    const otra = await login();

    const res = await http()
      .post(api("/auth/revoke-all"))
      .set(...bearer(session.accessToken))
      .send({});

    expect(res.status).toBe(204);
    expect(otra.sessionId).not.toBe(session.sessionId);

    for (const token of [session.refreshToken, otra.refreshToken]) {
      const refresh = await http()
        .post(api("/auth/refresh"))
        .send({ refreshToken: token });
      expect(refresh.status).toBe(401);
    }
  });
});

describe("POST /api/v1/auth/switch-tenant", () => {
  it("cambia el tenant activo y emite tokens nuevos", async () => {
    const session = await register();
    const segundo = await addSecondTenant(session.user.id);

    const res = await http()
      .post(api("/auth/switch-tenant"))
      .set(...bearer(session.accessToken))
      .send({ tenantId: segundo });

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(segundo);
    expect(res.body.membership.role).toBe("AGENT");
    // Familia nueva: el `jti` anterior no se reutiliza entre tenants.
    expect(res.body.sessionId).not.toBe(session.sessionId);
  });

  it("devuelve 403 sin membresía en el tenant destino", async () => {
    const session = await register();
    const ajeno = await addForeignTenant();

    const res = await http()
      .post(api("/auth/switch-tenant"))
      .set(...bearer(session.accessToken))
      .send({ tenantId: ajeno });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("membership_inactive");
  });

  it("devuelve 400 si el tenantId no es un UUID", async () => {
    const session = await register();

    const res = await http()
      .post(api("/auth/switch-tenant"))
      .set(...bearer(session.accessToken))
      .send({ tenantId: "no-es-uuid" });

    expect(res.status).toBe(400);
  });
});

describe("contrato de error y rutas públicas", () => {
  it("el cuerpo de error es el envelope de @negocia/contracts", async () => {
    const res = await http().get(api("/me"));

    expect(res.body).toMatchObject({
      code: expect.any(String),
      message: expect.any(String),
    });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("el error incluye el requestId de correlación", async () => {
    const res = await http()
      .get(api("/me"))
      .set("X-Request-Id", "req-e2e-123");

    expect(res.body.requestId).toBe("req-e2e-123");
  });

  it("health sigue siendo público pese a la cadena de guards", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it("las rutas de auth no exigen Authorization", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "nadie@example.com", password: PASSWORD });

    // 401 de credenciales, no del guard: la ruta es pública.
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("invalid_credentials");
  });
});

describe("rate limiting", () => {
  it("registro repetido acaba en 429 con el contrato de error", async () => {
    // El límite de registro es 5 por 10 min; el sexto intento debe rebotar.
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer())
        .post(api("/auth/register"))
        .send({
          name: `Persona ${i}`,
          email: `persona${i}@example.com`,
          password: PASSWORD,
        });
      expect(res.status).toBe(201);
    }

    const res = await request(app.getHttpServer())
      .post(api("/auth/register"))
      .send({ name: "Sexta", email: "sexta@example.com", password: PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe("rate_limited");
  });
});

describe("recuperación de contraseña", () => {
  /** Último token de reset enviado por el mock; `undefined` si no hubo envío. */
  function lastResetToken(): string | undefined {
    return emails.sent
      .filter((m) => m.template === "reset-password")
      .at(-1)?.token;
  }

  async function solicitar(email: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .post(api("/auth/forgot-password"))
      .send({ email });
    return res.status;
  }

  it("emite 204 uniforme, restablece y revoca las sesiones previas", async () => {
    const session = await register();
    const otra = await login();

    expect(await solicitar("ana@example.com")).toBe(204);

    const token = lastResetToken();
    expect(token).toBeTruthy();

    const reset = await request(app.getHttpServer())
      .post(api("/auth/reset-password"))
      .send({ token, newPassword: "NuevaContraseña1!" });
    expect(reset.status).toBe(204);

    // Las familias abiertas antes del reset dejan de servir.
    for (const refresh of [session.refreshToken, otra.refreshToken]) {
      const reutilizado = await request(app.getHttpServer())
        .post(api("/auth/refresh"))
        .send({ refreshToken: refresh });
      expect(reutilizado.status).toBe(401);
    }

    // La contraseña vieja ya no abre sesión y la nueva sí.
    const vieja = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "ana@example.com", password: PASSWORD });
    expect(vieja.status).toBe(401);
    const nueva = await request(app.getHttpServer())
      .post(api("/auth/login"))
      .send({ email: "ana@example.com", password: "NuevaContraseña1!" });
    expect(nueva.status).toBe(200);
  });

  it("no revela si el email existe: mismo 204 sin email ni token", async () => {
    expect(await solicitar("nadie@example.com")).toBe(204);
    expect(lastResetToken()).toBeUndefined();
  });

  it("no emite resets para cuentas deshabilitadas", async () => {
    const session = await register();
    await disableUser(session.user.id);

    expect(await solicitar("ana@example.com")).toBe(204);
    expect(lastResetToken()).toBeUndefined();
  });

  it("rechaza un token inventado con invalid_token", async () => {
    await register();

    const res = await request(app.getHttpServer())
      .post(api("/auth/reset-password"))
      .send({ token: "inventado", newPassword: "NuevaContraseña1!" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_token");
  });

  it("el token es de 1-uso: el segundo intento falla", async () => {
    await register();
    expect(await solicitar("ana@example.com")).toBe(204);
    const token = lastResetToken()!;

    await request(app.getHttpServer())
      .post(api("/auth/reset-password"))
      .send({ token, newPassword: "NuevaContraseña1!" });

    const reutilizado = await request(app.getHttpServer())
      .post(api("/auth/reset-password"))
      .send({ token, newPassword: "OtraContraseña2!" });
    expect(reutilizado.status).toBe(400);
    expect(reutilizado.body.code).toBe("invalid_token");
  });

  it("valida el body con el envelope de error", async () => {
    const res = await request(app.getHttpServer())
      .post(api("/auth/reset-password"))
      .send({ token: "x", newPassword: "corta" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_error");
  });
});

/* ------------------------------------------------------------------ */
/* Manipulación directa de BD: simula cambios administrativos que la    */
/* API de M-4 todavía no expone, para comprobar que los guards los     */
/* recogen en el request siguiente.                                     */
/* ------------------------------------------------------------------ */

const SEGUNDO_TENANT_ID = "3f2b1c4d-0000-4000-8000-0000000000a1";
const AJENO_TENANT_ID = "3f2b1c4d-0000-4000-8000-0000000000a2";
const MEMBERSHIP_ID = "3f2b1c4d-0000-4000-8000-0000000000a3";

async function prisma() {
  const { testDatabase } = await import("./helpers/database");
  return testDatabase();
}

async function disableUser(userId: string): Promise<void> {
  await (await prisma()).user.update({
    where: { id: userId },
    data: { status: "DISABLED" },
  });
}

async function setTenantStatus(
  tenantId: string,
  status: string,
): Promise<void> {
  await (await prisma()).tenant.update({ where: { id: tenantId }, data: { status } });
}

async function setMembershipRole(
  membershipId: string,
  role: string,
): Promise<void> {
  await (await prisma()).membership.update({
    where: { id: membershipId },
    data: { role },
  });
}

async function addSecondTenant(userId: string): Promise<string> {
  const db = await prisma();
  await db.tenant.create({
    data: {
      id: SEGUNDO_TENANT_ID,
      slug: "segundo",
      name: "Segundo",
      plan: "BASIC",
      status: "ACTIVE",
      updatedAt: new Date(),
    },
  });
  await db.membership.create({
    data: {
      id: MEMBERSHIP_ID,
      tenantId: SEGUNDO_TENANT_ID,
      userId,
      role: "AGENT",
      status: "ACTIVE",
      updatedAt: new Date(),
    },
  });
  return SEGUNDO_TENANT_ID;
}

async function addForeignTenant(): Promise<string> {
  const db = await prisma();
  await db.tenant.create({
    data: {
      id: AJENO_TENANT_ID,
      slug: "ajeno",
      name: "Ajeno",
      plan: "BASIC",
      status: "ACTIVE",
      updatedAt: new Date(),
    },
  });
  return AJENO_TENANT_ID;
}
