import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { AuthenticationError } from "../../domain/errors";
import { JwtAccessTokenIssuer } from "./jwt-access-token-issuer";

const SECRET = "clave-de-prueba-de-32-bytes-minimo!!";
const NOW = new Date("2026-09-29T12:00:00.000Z");

function build(overrides: Partial<{ secret: string; issuer: string; audience: string }> = {}) {
  return new JwtAccessTokenIssuer({
    secret: overrides.secret ?? SECRET,
    issuer: overrides.issuer ?? "negocia-api",
    audience: overrides.audience ?? "negocia-clients",
  });
}

describe("JwtAccessTokenIssuer", () => {
  it("emite un token con exactamente los claims acordados", async () => {
    const issuer = build();
    const token = await issuer.issue({
      userId: "user-1",
      sessionId: "session-1",
      tenantId: "tenant-1",
      ttlSeconds: 900,
      now: NOW,
    });

    const claims = decodeJwt(token);
    expect(claims).toMatchObject({
      sub: "user-1",
      jti: "session-1",
      tenant_id: "tenant-1",
      iss: "negocia-api",
      aud: "negocia-clients",
    });
    expect(claims.iat).toBe(Math.floor(NOW.getTime() / 1000));
    expect(claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + 900);
  });

  it("NO incluye rol ni permisos en el token", async () => {
    // El JWT solo lleva identidad. Si alguien añadiera `role`, un cambio de
    // rol no podría aplicarse hasta que expirara el token.
    const token = await build().issue({
      userId: "user-1",
      sessionId: "session-1",
      tenantId: "tenant-1",
      ttlSeconds: 900,
      now: NOW,
    });

    const claims = decodeJwt(token) as Record<string, unknown>;
    for (const forbidden of [
      "role",
      "roles",
      "permissions",
      "plan",
      "membershipId",
      "email",
    ]) {
      expect(claims).not.toHaveProperty(forbidden);
    }
  });

  it("el jti coincide con el session_id de la familia de refresh", async () => {
    const token = await build().issue({
      userId: "user-1",
      sessionId: "session-abc",
      tenantId: "tenant-1",
      ttlSeconds: 900,
      now: NOW,
    });

    // Es lo que permite que `logout` cierre la familia correcta sin depender
    // del body de la petición.
    expect(decodeJwt(token).jti).toBe("session-abc");
  });

  it("falla al construir con un secreto de menos de 32 bytes", () => {
    // Se valida al arrancar, no en el primer login: un secreto débil en
    // producción es un incidente, no un detalle de configuración.
    expect(() => build({ secret: "corto" })).toThrowError(/32 bytes/);
  });

  it("rechaza un token firmado con otro secreto", async () => {
    const token = await build().issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: NOW,
    });
    const otro = build({ secret: "otra-clave-de-32-bytes-minimo-abc" });

    await expect(otro.verify(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rechaza un token de otro issuer", async () => {
    const token = await build().issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: NOW,
    });
    const otro = build({ issuer: "otro-servicio" });

    await expect(otro.verify(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rechaza un token dirigido a otra audiencia", async () => {
    const token = await build().issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: NOW,
    });
    const otro = build({ audience: "otra-app" });

    await expect(otro.verify(token)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rechaza un token expirado", async () => {
    const issuer = build();
    const token = await issuer.issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: new Date(Date.now() - 7_200_000),
    });

    await expect(issuer.verify(token)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("acepta un token dentro de la ventana de tolerancia de reloj", async () => {
    // Dos máquinas siempre están desfasadas unos segundos; sin tolerancia,
    // un token válido en un nodo sería rechazado por otro.
    const issuer = build();
    const token = await issuer.issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: new Date(Date.now() - 8_000),
    });

    await expect(issuer.verify(token)).resolves.toMatchObject({ sub: "u" });
  });

  it("rechaza el algoritmo 'none'", async () => {
    // Defensa contra confusión de algoritmo: el algoritmo está fijado en
    // código, y un token sin firma debe rechazarse siempre.
    const payload = Buffer.from(
      JSON.stringify({
        sub: "u",
        jti: "s",
        tenant_id: "t",
        iss: "negocia-api",
        aud: "negocia-clients",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString("base64url");
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");

    await expect(
      build().verify(`${header}.${payload}.`),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rechaza un token sin tenant_id", async () => {
    // El claim es obligatorio: sin él no hay aislamiento multi-tenant posible.
    const issuer = build();
    const token = await issuer.issue({
      userId: "u",
      sessionId: "s",
      tenantId: "t",
      ttlSeconds: 900,
      now: NOW,
    });
    const claims = decodeJwt(token);
    delete claims.tenant_id;
    const reSigned = await reSign(claims);

    await expect(issuer.verify(reSigned)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("todos los fallos colapsan en el mismo 401 genérico", async () => {
    const issuer = build();
    const errores = await Promise.all([
      issuer.verify("basura").catch((e: Error) => e),
      issuer.verify("a.b.c").catch((e: Error) => e),
    ]);

    // Mensajes distintos ayudarían a un atacante a distinguir "firmado por
    // otro servicio" de "expirado".
    expect((errores[0] as Error).message).toBe((errores[1] as Error).message);
  });
});

async function reSign(claims: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import("jose");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(SECRET));
}
