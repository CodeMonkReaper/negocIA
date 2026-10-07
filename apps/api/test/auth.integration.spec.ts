import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { validateEnv } from "@negocia/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseModule } from "../src/infrastructure/database/database.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { MockEmailAdapter } from "../src/infrastructure/email-sender.mock";
import { JwtAccessTokenIssuer } from "../src/infrastructure/security/jwt-access-token-issuer";
import { AuthModule } from "../src/modules/auth/auth.module";
import { AuthConfigService } from "../src/modules/auth/application/auth-config.service";
import { AuthService } from "../src/modules/auth/application/auth.service";
import {
  closeTestDatabase,
  resetDatabase,
} from "./helpers/database";
import { testUrl } from "./helpers/env";

/**
 * Integración de M-4 contra PostgreSQL real.
 *
 * Monta el **grafo de DI real** (`DatabaseModule` + `AuthModule`) apuntando al
 * schema `negocia_test`, de modo que la prueba cubre a la vez los adaptadores
 * de Prisma y los bindings de puertos. Un grafo montado a mano en el test
 * pasaría aunque el `useExisting` del módulo real estuviera mal.
 *
 * Aquí se verifica lo que un doble en memoria no puede:
 *  - los `NOT NULL` y los índices únicos de `refresh_tokens`;
 *  - la atomicidad real de la transacción de `register` y de la rotación;
 *  - la traducción de P2002 a errores de dominio;
 *  - que el `tenant_id` de una familia sobreviva a las rotaciones.
 *
 * Argon2 va con el coste mínimo del entorno de test: la corrección del
 * algoritmo y de sus parámetros se verifica en los unitarios, y aquí 20
 * registros a 19 MiB serían minutos.
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

/**
 * Tenants de apoyo.
 *
 * Los ids son UUID válidos porque las columnas son `uuid` con valores por
 * defecto de `gen_random_uuid()`: un id legible tipo `"segundo"` lo rechaza
 * PostgreSQL en la propia sentencia, no Prisma, y el error resultante sugiere
 * un problema de tipos cuando en realidad es del dato del test.
 */
const SEGUNDO_TENANT_ID = "3f2b1c4d-0000-4000-8000-000000000002";
const AJENO_TENANT_ID = "3f2b1c4d-0000-4000-8000-000000000004";
const INVENTADO_TENANT_ID = "3f2b1c4d-0000-4000-8000-0000000000ff";
const SEGUNDA_MEMBERSHIP_ID = "3f2b1c4d-0000-4000-8000-000000000003";
const RIVAL_USER_ID = "3f2b1c4d-0000-4000-8000-000000000001";

interface Harness {
  auth: AuthService;
  config: AuthConfigService;
  accessTokens: JwtAccessTokenIssuer;
  email: MockEmailAdapter;
  prisma: PrismaService;
}

async function harness(): Promise<Harness> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        cache: true,
        // La URL entra por `load` y no por `process.env` porque el entorno del
        // proceso es global y compartido entre los specs.
        //
        // El validador real se aplica **dentro** de la factory y no con la
        // opción `validate`: esa opción corre sobre `process.env` y su
        // resultado se sobrescribe después con lo que devuelve `load`. Pasarlo
        // por `load` es la única forma de que los TTL lleguen ya como número
        // (`jose` rechaza "900" como periodo de tiempo), y de paso la suite
        // sigue exercising exactamente la validación que corre en producción.
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
    ],
  }).compile();

  await module.init();

  return {
    auth: module.get(AuthService),
    config: module.get(AuthConfigService),
    accessTokens: module.get(JwtAccessTokenIssuer),
    email: module.get(MockEmailAdapter),
    prisma: module.get(PrismaService),
  };
}

function register(h: Harness, email = "ana@example.com", name = "Ana Torres") {
  return h.auth.register({ email, name, password: PASSWORD });
}

describe("M-4 Auth (integración con PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("registra usuario, tenant y membresía OWNER de forma atómica", async () => {
    const h = await harness();

    const session = await register(h);

    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.tenant.slug).toBe("ana-torres");
    expect(session.membership.role).toBe("OWNER");
    expect(session.membership.tenantId).toBe(session.tenant.id);

    const claims = await h.accessTokens.verify(session.accessToken);
    expect(claims.tenant_id).toBe(session.tenant.id);
    expect(claims.sub).toBe(session.user.id);
    // El rol no viaja en el token: se relee de la tabla en cada request.
    expect(Object.keys(claims)).not.toContain("role");
    expect(Object.keys(claims)).not.toContain("email");

    const db = h.prisma.db;
    expect(await db.user.count()).toBe(1);
    expect(await db.tenant.count()).toBe(1);
    expect(await db.membership.count()).toBe(1);
  });

  it("no deja usuario huérfano si el alta falla a mitad de la transacción", async () => {
    const h = await harness();

    // Se fuerza el fallo en el último paso (membresía) con un tenant ya
    // existente y sin hueco: el slug se desambigua, así que la vía natural es
    // violar la unicidad del email desde fuera.
    await register(h, "primera@example.com");

    await h.prisma.db.user.create({
      data: {
        id: RIVAL_USER_ID,
        email: "segunda@example.com",
        passwordHash: "x",
        name: "Otra",
        status: "ACTIVE",
      },
    });

    await expect(
      register(h, "segunda@example.com", "Otra Persona"),
    ).rejects.toMatchObject({ code: "email_already_registered" });

    // Ni tenant ni membresía de la perdedora: la transacción se deshizo entera.
    const db = h.prisma.db;
    expect(await db.tenant.count()).toBe(1);
    expect(await db.membership.count()).toBe(1);
    expect(await db.user.count()).toBe(2);
  });

  it("desambigua el slug con sufijo en vez de rechazar el registro", async () => {
    const h = await harness();

    await register(h, "primera@example.com");
    const second = await register(h, "segunda@example.com");

    expect(second.tenant.slug).not.toBe("ana-torres");
    expect(second.tenant.slug.startsWith("ana-torres")).toBe(true);
  });

  it("persiste solo el SHA-256 del refresh token", async () => {
    const h = await harness();
    const session = await register(h);

    const rows = await h.prisma.db.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(session.refreshToken);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    expect(JSON.stringify(rows)).not.toContain(session.refreshToken);
  });

  it("renueva conservando el tenant_id de la familia", async () => {
    const h = await harness();
    const session = await register(h);

    const rotated = await h.auth.refresh({ refreshToken: session.refreshToken });

    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    const claims = await h.accessTokens.verify(rotated.accessToken);
    expect(claims.tenant_id).toBe(session.tenant.id);

    // La fila sucesor hereda el tenant de la raíz: sin esta copia, renovar
    // cuando el access ya caducó no podría reconstruir el claim.
    const rows = await h.prisma.db.refreshToken.findMany();
    expect(rows.every((r) => r.tenantId === session.tenant.id)).toBe(true);
  });

  it("detecta la reutilización y revoca la familia completa", async () => {
    const h = await harness();
    const session = await register(h);

    const rotated = await h.auth.refresh({ refreshToken: session.refreshToken });
    const vivos = () =>
      h.prisma.db.refreshToken.count({ where: { revokedAt: null } });
    expect(await vivos()).toBe(1);

    // El predecesor vuelve a presentarse: hay una copia en otro lado.
    await expect(
      h.auth.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toMatchObject({ code: "reuse_detected" });
    expect(await vivos()).toBe(0);

    // El sucesor legítimo también cae, y con el mismo código: un token revocado
    // es indistinguible de un token robado, y ante la duda se fuerza el
    // re-login en lugar de mantener viva una sesión que ya no es de fiar.
    await expect(
      h.auth.refresh({ refreshToken: rotated.refreshToken }),
    ).rejects.toMatchObject({ code: "reuse_detected" });
  });

  it("rechaza un refresh token inventado", async () => {
    const h = await harness();

    await expect(
      h.auth.refresh({ refreshToken: "no-existe" }),
    ).rejects.toMatchObject({ code: "invalid_refresh_token" });
  });

  it("cierra la familia usando el jti del access token", async () => {
    const h = await harness();
    const session = await register(h);
    const claims = await h.accessTokens.verify(session.accessToken);

    // Logout sin el refresh token: el ancla es el `jti`. Si solo dependiera
    // del body, un access token robado no cerraría su propia sesión.
    const revoked = await h.auth.logout(claims.jti);

    expect(revoked).toBeGreaterThanOrEqual(1);
    expect(
      await h.prisma.db.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(0);
  });

  it("revoke-all cierra todas las sesiones del usuario", async () => {
    const h = await harness();
    const a = await register(h);
    const b = await h.auth.login({ email: "ana@example.com", password: PASSWORD });
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(
      await h.prisma.db.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(2);

    await h.auth.revokeAll(a.user.id);

    expect(
      await h.prisma.db.refreshToken.count({ where: { revokedAt: null } }),
    ).toBe(0);
  });

  it("cambia de tenant emitiendo tokens del tenant destino", async () => {
    const h = await harness();
    const first = await register(h);

    await h.prisma.db.tenant.create({
      data: {
        id: SEGUNDO_TENANT_ID,
        slug: "segundo",
        name: "Segundo",
        plan: "BASIC",
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });
    await h.prisma.db.membership.create({
      data: {
        id: SEGUNDA_MEMBERSHIP_ID,
        tenantId: SEGUNDO_TENANT_ID,
        userId: first.user.id,
        role: "AGENT",
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });

    const swapped = await h.auth.switchTenant(first.user.id, SEGUNDO_TENANT_ID);

    expect(swapped.tenant.id).toBe(SEGUNDO_TENANT_ID);
    const claims = await h.accessTokens.verify(swapped.accessToken);
    expect(claims.tenant_id).toBe(SEGUNDO_TENANT_ID);
    // El cambio de tenant no escala privilegios: el rol viene de la fila.
    expect(swapped.membership.role).toBe("AGENT");
    // Familia nueva: un mismo `jti` sirviendo a dos tenants haría que un
    // logout cerrara sesiones de dos empresas a la vez.
    expect(swapped.sessionId).not.toBe(first.sessionId);
  });

  it("no revela la existencia de un tenant ajeno", async () => {
    const h = await harness();
    const first = await register(h);

    await h.prisma.db.tenant.create({
      data: {
        id: AJENO_TENANT_ID,
        slug: "ajeno",
        name: "Ajeno",
        plan: "BASIC",
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });

    // Mismo código que "el tenant no existe".
    await expect(h.auth.switchTenant(first.user.id, AJENO_TENANT_ID)).rejects.toMatchObject(
      { code: "membership_inactive" },
    );
    await expect(h.auth.switchTenant(first.user.id, INVENTADO_TENANT_ID)).rejects.toMatchObject(
      { code: "membership_inactive" },
    );
  });

  it("el login falla igual con email inexistente y con contraseña mala", async () => {
    const h = await harness();
    await register(h);

    await expect(
      h.auth.login({ email: "nadie@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      h.auth.login({ email: "ana@example.com", password: "OtraClave1!" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("no permite el login de una cuenta desactivada", async () => {
    const h = await harness();
    const session = await register(h);

    await h.prisma.db.user.update({
      where: { id: session.user.id },
      data: { status: "DISABLED" },
    });

    await expect(
      h.auth.login({ email: "ana@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "account_disabled" });
  });

  it("impide renovar si la cuenta se desactivó entre rotaciones", async () => {
    const h = await harness();
    const session = await register(h);

    await h.prisma.db.user.update({
      where: { id: session.user.id },
      data: { status: "DISABLED" },
    });

    await expect(
      h.auth.refresh({ refreshToken: session.refreshToken }),
    ).rejects.toMatchObject({ code: "account_disabled" });
  });

  it("excluye del login las membresías cuyo tenant está inactivo", async () => {
    const h = await harness();
    const session = await register(h);

    // `tenants.status` admite ACTIVE | SUSPENDED | CLOSED: para usuarios es
    // ACTIVE | DISABLED, así que el valor suspended no es intercambiable.
    await h.prisma.db.tenant.update({
      where: { id: session.tenant.id },
      data: { status: "SUSPENDED" },
    });

    // Emitir un access token que el `TenantContextGuard` rechazaría en el
    // request siguiente es un fallo de UX, no de seguridad; se evita en origen.
    await expect(
      h.auth.login({ email: "ana@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "membership_inactive" });
  });

  it("el hash de contraseña usa argon2id con sal por usuario", async () => {
    const h = await harness();
    await register(h, "a@example.com", "Ana Torres");
    await register(h, "b@example.com", "Beatriz Soto");

    const hashes = (h.prisma.db.user.findMany() as unknown as Promise<
      Array<{ passwordHash: string }>
    >).then((rows) => rows.map((r) => r.passwordHash));

    const values = await hashes;
    expect(values.every((v) => v.startsWith("$argon2id$"))).toBe(true);
    expect(new Set(values).size).toBe(2);
  });

  it("nunca guarda el token de verificación en claro", async () => {
    const h = await harness();
    await register(h);

    const rows = await h.prisma.db.verificationToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toHaveLength(64);
    expect(rows[0]?.usedAt).toBeNull();
    // El token crudo salió por el adaptador de email, no por la base de datos.
    const enviado = h.email.sent.find((m) => m.template === "verification");
    expect(enviado?.token).toBeTruthy();
    expect(rows[0]?.tokenHash).not.toBe(enviado?.token);
  });
});
