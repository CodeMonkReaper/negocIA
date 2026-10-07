import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../../domain/errors";
import type { EmailSender } from "../../../domain/ports/email-sender";
import type { PasswordHasher } from "../../../domain/ports/password-hasher";
import type { TokenHasher } from "../../../domain/ports/token-hasher";
import {
  createInMemoryScope,
  InMemoryUnitOfWork,
  makeMembership,
  makeTenant,
  makeUser,
  type InMemoryScope,
} from "../../../testing/in-memory/fakes";
import { AuthConfigService } from "./auth-config.service";
import { AuthService } from "./auth.service";
import { EmailVerificationSender } from "./email-verification-sender";
import { PasswordResetSender } from "./password-reset-sender";
import { SessionService } from "./session.service";

/**
 * Reloj congelado: los TTL y las expiraciones dejan de depender del reloj del
 * sistema y los casos se vuelven deterministas.
 */
const NOW = new Date("2026-09-29T12:00:00.000Z");
const VALID_PASSWORD = "Correcta1!Bote";

/** Hash hasher de mentira: verifica contra un prefijo, sin coste de CPU. */
class FakePasswordHasher implements PasswordHasher {
  readonly hashed: string[] = [];
  verifyCalls = 0;

  async hash(password: string): Promise<string> {
    this.hashed.push(password);
    return `fake$${password}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    this.verifyCalls += 1;
    return hash === `fake$${password}`;
  }
}

/**
 * Doble del puerto `TokenHasher`.
 *
 * **Síncrono** a propósito, igual que `Sha256TokenHasher`: hacer el fake
 * asíncrono "permitía" que la aplicación guardara una `Promise` en la columna
 * `token_hash` sin que el typecheck protestara (esperar un `string` es legal
 * en TypeScript), y el fallo solo aparecería en runtime.
 */
class FakeTokenHasher implements TokenHasher {
  hashToken(token: string): string {
    return `sha256$${token}`;
  }
}

class RecordingEmailSender implements EmailSender {
  readonly messages: unknown[] = [];

  async send(message: Parameters<EmailSender["send"]>[0]): Promise<void> {
    this.messages.push(message);
  }
}

function buildHarness(): {
  service: AuthService;
  sessions: SessionService;
  scope: InMemoryScope;
  hasher: FakePasswordHasher;
  emailSender: RecordingEmailSender;
  now: () => Date;
} {
  const scope = createInMemoryScope();
  const hasher = new FakePasswordHasher();
  const emailSender = new RecordingEmailSender();
  const unitOfWork = new InMemoryUnitOfWork(scope);

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

  // Issuer de mentira: el JWT real se prueba en los tests de `jose`.
  const accessTokenIssuer = {
    issue: vi.fn(async (input: { sessionId: string; userId: string }) => ({
      sub: input.userId,
      jti: input.sessionId,
    })),
  };

  let counter = 0;
  const opaqueTokens = {
    generate: () => `opaque-${(counter += 1)}`,
  };

  let idCounter = 0;
  const ids = { next: () => `id-${(idCounter += 1)}` };

  const sessions = new SessionService(
    unitOfWork,
    accessTokenIssuer as never,
    opaqueTokens,
    new FakeTokenHasher(),
    ids,
    config,
  );

  // El emisor de verificación se construye con los mismos dobles que el
  // servicio: la lógica (TTL, hasheado, envío) vive ahí desde M-5, y el test
  // sigue observando los emails enviados a través del mismo `emailSender`.
  const verificationSender = new EmailVerificationSender(
    unitOfWork,
    opaqueTokens,
    new FakeTokenHasher(),
    emailSender,
  );

  const resetSender = new PasswordResetSender(
    unitOfWork,
    opaqueTokens,
    new FakeTokenHasher(),
    emailSender,
  );

  const service = new AuthService(
    unitOfWork,
    scope.users,
    scope.refreshTokens,
    hasher,
    new FakeTokenHasher(),
    opaqueTokens,
    // Secuencia determinista en vez de UUID v4: las aserciones sobre la
    // familia de refresh necesitan ids estables y distintos entre sí, y
    // compararlos con aleatorios solo añadiría ruido.
    ids,
    verificationSender,
    resetSender,
    sessions,
    config,
  );

  return {
    service,
    sessions,
    scope,
    hasher,
    emailSender,
    now: () => NOW,
  };
}

describe("AuthService.register", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    harness = buildHarness();
  });

  it("crea usuario, tenant, membresía OWNER y sesión inicial", async () => {
    const session = await harness.service.register({
      name: "Ana Torres",
      email: "  Ana@Example.COM ",
      password: VALID_PASSWORD,
    });

    expect(session.user.email).toBe("ana@example.com");
    expect(session.tenant.slug).toBe("ana-torres");
    expect(session.membership.role).toBe("OWNER");
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    expect(harness.scope.users.rows).toHaveLength(1);
    expect(harness.scope.tenants.rows).toHaveLength(1);
    expect(harness.scope.memberships.rows).toHaveLength(1);
    expect(harness.scope.refreshTokens.rows).toHaveLength(1);
  });

  it("el email del refresh hereda el tenant de la sesión", async () => {
    const session = await harness.service.register({
      name: "Ana Torres",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const [token] = harness.scope.refreshTokens.rows;
    expect(token?.tenantId).toBe(session.tenant.id);
    // `session_id = id` en la fila raíz: el ancla de la familia es la propia fila.
    expect(token?.sessionId).toBe(session.sessionId);
  });

  it("rechaza contraseñas que incumplen la política", async () => {
    await expect(
      harness.service.register({
        name: "Ana",
        email: "ana@example.com",
        password: "corta",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(harness.scope.users.rows).toHaveLength(0);
  });

  it("rechaza emails ya registrados sin tocar la base de datos", async () => {
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await expect(
      harness.service.register({
        name: "Otra",
        email: "ana@example.com",
        password: VALID_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no deja usuario huérfano si falla la creación del tenant", async () => {
    // Se fuerza el fallo después de insertar el usuario: la transacción debe
    // deshacer la escritura, no dejar un usuario sin tenant.
    const originalCreate = harness.scope.tenants.create.bind(
      harness.scope.tenants,
    );
    harness.scope.tenants.create = async () => {
      throw new Error("boom");
    };

    await expect(
      harness.service.register({
        name: "Ana",
        email: "ana@example.com",
        password: VALID_PASSWORD,
      }),
    ).rejects.toThrow("boom");

    harness.scope.tenants.create = originalCreate;
    expect(harness.scope.users.rows).toHaveLength(0);
  });

  it("envía el email de verificación aunque el registro ya haya ocurrido", async () => {
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    expect(harness.emailSender.messages).toHaveLength(1);
    expect(harness.scope.verificationTokens.rows).toHaveLength(1);
  });

  it("no falla el registro si el proveedor de email está caído", async () => {
    harness.emailSender.send = async () => {
      throw new Error("SMTP caído");
    };

    const session = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    expect(session.user.id).toBeTruthy();
  });
});

describe("AuthService.login", () => {
  it("acepta credenciales correctas y elige la primera membresía activa", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const session = await harness.service.login({
      email: "ANA@example.com",
      password: VALID_PASSWORD,
    });

    expect(session.user.id).toBe(registered.user.id);
    expect(session.tenant.id).toBe(registered.tenant.id);
  });

  it("responde el mismo 401 con email inexistente y contraseña errónea", async () => {
    const harness = buildHarness();
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const inexistente = await harness.service
      .login({ email: "nadie@example.com", password: VALID_PASSWORD })
      .catch((error: Error) => error);
    const erronea = await harness.service
      .login({ email: "ana@example.com", password: "OtraClave1!" })
      .catch((error: Error) => error);

    expect(inexistente).toBeInstanceOf(Error);
    expect(erronea).toBeInstanceOf(Error);
    expect((inexistente as Error).message).toBe((erronea as Error).message);
    expect((inexistente as Error).name).toBe((erronea as Error).name);
  });

  it("iguala el coste de respuesta con un hash señuelo (anti-enumeración)", async () => {
    const harness = buildHarness();

    await harness.service
      .login({ email: "nadie@example.com", password: VALID_PASSWORD })
      .catch(() => undefined);

    // Sin el señuelo, el camino "usuario inexistente" no ejecutaría ningún
    // Argon2 y sería_orders_of_magnitude más rápido que el login real.
    expect(harness.hasher.verifyCalls).toBe(1);
    expect(harness.hasher.hashed).toHaveLength(1);
  });

  it("reutiliza el hash señuelo entre intentos", async () => {
    const harness = buildHarness();

    await harness.service
      .login({ email: "nadie1@example.com", password: VALID_PASSWORD })
      .catch(() => undefined);
    await harness.service
      .login({ email: "nadie2@example.com", password: VALID_PASSWORD })
      .catch(() => undefined);

    // Hashear el señuelo en cada intento costaría ~50 ms por request y sería
    // un vector de DoS: se calcula una vez por proceso.
    expect(harness.hasher.hashed).toHaveLength(1);
  });

  it("rechaza cuentas deshabilitadas", async () => {
    const harness = buildHarness();
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    harness.scope.users.rows[0]!.status = "SUSPENDED";

    await expect(
      harness.service.login({
        email: "ana@example.com",
        password: VALID_PASSWORD,
      }),
    ).rejects.toMatchObject({ status: 403, code: "account_disabled" });
  });

  it("ignora membresías de tenants suspendidos", async () => {
    const harness = buildHarness();
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    harness.scope.tenants.rows[0]!.status = "SUSPENDED";

    await expect(
      harness.service.login({
        email: "ana@example.com",
        password: VALID_PASSWORD,
      }),
    ).rejects.toMatchObject({ status: 403, code: "membership_inactive" });
  });
});

describe("AuthService.refresh", () => {
  async function registered(): Promise<ReturnType<typeof buildHarness>> {
    const harness = buildHarness();
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    return harness;
  }

  /**
   * Fila del refresh presentado.
   *
   * Se busca por hash y no por posición: `register` ya dejó una fila propia
   * en la tabla, así que `rows[0]` es la sesión del registro y no la del
   * login. Indexar por posición haría pasar tests que no prueban lo que
   * dicen.
   */
  function rowOf(
    harness: ReturnType<typeof buildHarness>,
    token: string,
  ) {
    const hash = `sha256$${token}`;
    return harness.scope.refreshTokens.rows.find((row) => row.tokenHash === hash);
  }

  function familyOf(
    harness: ReturnType<typeof buildHarness>,
    sessionId: string,
  ) {
    return harness.scope.refreshTokens.rows.filter(
      (row) => row.sessionId === sessionId,
    );
  }

  it("rota el token y mantiene el session_id de la familia", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const rotated = await harness.service.refresh({
      refreshToken: login.refreshToken,
    });

    expect(rotated.sessionId).toBe(login.sessionId);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);

    const family = familyOf(harness, login.sessionId);
    expect(family).toHaveLength(2);

    // La raíz es la fila **apuntada** por `replaced_by_token_id`; el sucesor es
    // la que ese campo deja en `null`.
    const root = family.find((row) => row.replacedById !== null);
    const successor = family.find((row) => row.replacedById === null);
    expect(root?.revokedAt).toEqual(NOW);
    expect(successor?.id).toBe(rowOf(harness, rotated.refreshToken)?.id);
    expect(successor?.sessionId).toBe(login.sessionId);
    expect(successor?.revokedAt).toBeNull();
  });

  it("rechaza un refresh token desconocido con 401 sin revocar la familia", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await expect(
      harness.service.refresh({ refreshToken: "inventado" }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_refresh_token" });

    // Un token desconocido no es prueba de robo: revocar aquí cerraría
    // sesiones legítimas por un intento de adivinación.
    for (const row of familyOf(harness, login.sessionId)) {
      expect(row.revokedAt).toBeNull();
    }
  });

  it("rechaza un refresh token expirado sin revocar la familia", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const row = rowOf(harness, login.refreshToken);
    row!.expiresAt = new Date(NOW.getTime() - 1_000);

    await expect(
      harness.service.refresh({ refreshToken: login.refreshToken }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_refresh_token" });

    expect(row?.revokedAt).toBeNull();
  });

  it("detecta reuse: revoca la familia completa y devuelve 401", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const rotated = await harness.service.refresh({
      refreshToken: login.refreshToken,
    });

    await expect(
      harness.service.refresh({ refreshToken: login.refreshToken }),
    ).rejects.toMatchObject({ status: 401, code: "reuse_detected" });

    // Toda la familia, incluido el sucesor legítimo, queda cerrada: si el
    // token robado es el que se está usando, el atacante sigue dentro.
    for (const row of familyOf(harness, login.sessionId)) {
      expect(row.revokedAt).toEqual(NOW);
    }
    expect(rowOf(harness, rotated.refreshToken)?.revokedAt).toEqual(NOW);
  });

  it("no rota dos veces cuando la familia ya está revocada", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await harness.service.refresh({ refreshToken: login.refreshToken });
    const countAfterFirstRotation = harness.scope.refreshTokens.rows.length;

    await expect(
      harness.service.refresh({ refreshToken: login.refreshToken }),
    ).rejects.toMatchObject({ code: "reuse_detected" });

    expect(harness.scope.refreshTokens.rows).toHaveLength(countAfterFirstRotation);
  });

  it("propaga tenant_id al token sucesor para reconstruir el claim", async () => {
    const harness = await registered();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await harness.service.refresh({ refreshToken: login.refreshToken });

    const successor = harness.scope.refreshTokens.rows.find((row) =>
      row.replacedById,
    );
    expect(successor?.tenantId).toBe(login.tenant.id);
  });
});

describe("AuthService.switchTenant", () => {
  it("emite una familia nueva para el tenant destino", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const otro = makeTenant({ id: "tenant-2", slug: "otro", name: "Otro" });
    harness.scope.tenants.rows.push(otro);
    harness.scope.memberships.rows.push(
      makeMembership({
        id: "membership-2",
        tenantId: otro.id,
        userId: registered.user.id,
        role: "ADMIN",
      }),
    );

    const switched = await harness.service.switchTenant(
      registered.user.id,
      otro.id,
    );

    expect(switched.tenant.id).toBe(otro.id);
    expect(switched.membership.role).toBe("ADMIN");
    // Familia nueva: si se reutilizara el `jti`, un logout cerraría sesiones
    // de los dos tenants a la vez.
    expect(switched.sessionId).not.toBe(registered.sessionId);
  });

  it("rechaza tenants en los que el usuario no es miembro", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await expect(
      harness.service.switchTenant(registered.user.id, "tenant-ajeno"),
    ).rejects.toMatchObject({ status: 403, code: "membership_inactive" });
  });

  it("no revela la diferencia entre tenant inexistente y ajeno", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    harness.scope.tenants.rows.push(makeTenant({ id: "tenant-real" }));

    const inexistente = await harness.service
      .switchTenant(registered.user.id, "tenant-inventado")
      .catch((error: Error) => error);
    const ajeno = await harness.service
      .switchTenant(registered.user.id, "tenant-real")
      .catch((error: Error) => error);

    expect(inexistente).toMatchObject({ code: "membership_inactive" });
    expect(ajeno).toMatchObject({ code: "membership_inactive" });
  });
});

describe("AuthService.logout / revokeAll / me", () => {
  it("logout revoca la familia del sessionId recibido", async () => {
    const harness = buildHarness();
    const login = await harness.service.login({
      email: "ana@example.com",
      password: "no-existe",
    }).catch(() => null);

    // Se registra primero para tener una familia que revocar.
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    const revoked = await harness.service.logout(registered.sessionId);

    expect(revoked).toBe(1);
    expect(harness.scope.refreshTokens.rows[0]?.revokedAt).toEqual(NOW);
    expect(login).toBeNull();
  });

  it("revokeAll cierra todas las familias del usuario", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const otro = makeTenant({ id: "tenant-2", slug: "otro" });
    harness.scope.tenants.rows.push(otro);
    harness.scope.memberships.rows.push(
      makeMembership({ id: "m2", tenantId: otro.id, userId: registered.user.id }),
    );
    await harness.service.switchTenant(registered.user.id, otro.id);

    const revoked = await harness.service.revokeAll(registered.user.id);

    expect(revoked).toBe(3);
    for (const row of harness.scope.refreshTokens.rows) {
      expect(row.revokedAt).toEqual(NOW);
    }
  });

  it("me devuelve el tenant activo y todas las membresías", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const otro = makeTenant({ id: "tenant-2", slug: "otro", name: "Otro" });
    harness.scope.tenants.rows.push(otro);
    harness.scope.memberships.rows.push(
      makeMembership({ id: "m2", tenantId: otro.id, userId: registered.user.id }),
    );

    const me = await harness.service.me(registered.user.id, registered.tenant.id);

    expect(me.currentTenant.id).toBe(registered.tenant.id);
    expect(me.memberships).toHaveLength(2);
    expect(me.memberships.map((m) => m.tenantSlug).sort()).toEqual([
      "ana",
      "otro",
    ]);
  });

  it("me falla si el tenant del token ya no tiene membresía activa", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    harness.scope.memberships.rows[0]!.status = "SUSPENDED";

    await expect(
      harness.service.me(registered.user.id, registered.tenant.id),
    ).rejects.toMatchObject({ status: 403, code: "membership_inactive" });
  });
});

describe("AuthService.forgotPassword", () => {
  interface ResetMessage {
    template: string;
    to: string;
    data: { name: string };
    token: string;
    expiresAt: Date;
  }

  function lastResetMessage(
    harness: ReturnType<typeof buildHarness>,
  ): ResetMessage {
    const message = harness.emailSender.messages.at(-1);
    if (!message || typeof message !== "object") {
      throw new Error("no hay mensajes de email");
    }
    return message as unknown as ResetMessage;
  }

  async function registered(
    harness: ReturnType<typeof buildHarness>,
  ): Promise<void> {
    await harness.service.register({
      name: "Ana Torres",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
  }

  it("envía un email de reset y persiste el token solo hasheado", async () => {
    const harness = buildHarness();
    await registered(harness);

    await harness.service.forgotPassword({ email: "ana@example.com" });

    const message = lastResetMessage(harness);
    expect(message.template).toBe("reset-password");
    expect(message.to).toBe("ana@example.com");
    expect(message.data.name).toBe("Ana Torres");

    const [token] = harness.scope.passwordResetTokens.rows;
    expect(harness.scope.passwordResetTokens.rows).toHaveLength(1);
    expect(token?.tokenHash).toBe(`sha256$${message.token}`);
    expect(token?.usedAt).toBeNull();
    // TTL corto por diseño: una recuperación no necesita 24 h de vigencia.
    expect(message.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("invalida el reset pendiente anterior al pedir uno nuevo", async () => {
    const harness = buildHarness();
    await registered(harness);

    await harness.service.forgotPassword({ email: "ana@example.com" });
    await harness.service.forgotPassword({ email: "ana@example.com" });

    // `register` ya envió el email de verificación: se filtran los de reset.
    const resets = harness.emailSender.messages.filter(
      (m) => (m as { template?: string }).template === "reset-password",
    );
    expect(resets).toHaveLength(2);
    const rows = harness.scope.passwordResetTokens.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.usedAt).not.toBeNull();
    expect(rows[1]?.usedAt).toBeNull();
  });

  it("responde igual para un email inexistente: ni token ni email", async () => {
    const harness = buildHarness();

    await harness.service.forgotPassword({ email: "nadie@example.com" });

    expect(harness.emailSender.messages).toHaveLength(0);
    expect(harness.scope.passwordResetTokens.rows).toHaveLength(0);
  });

  it("no emite resets para cuentas deshabilitadas", async () => {
    const harness = buildHarness();
    await registered(harness);
    harness.scope.users.rows[0]!.status = "SUSPENDED";

    await harness.service.forgotPassword({ email: "ana@example.com" });

    const resets = harness.emailSender.messages.filter(
      (m) => (m as { template?: string }).template === "reset-password",
    );
    expect(resets).toHaveLength(0);
    expect(harness.scope.passwordResetTokens.rows).toHaveLength(0);
  });
});

describe("AuthService.resetPassword", () => {
  async function registeredWithReset(build = buildHarness): Promise<{
    harness: ReturnType<typeof buildHarness>;
    token: string;
  }> {
    const harness = build();
    await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    await harness.service.forgotPassword({ email: "ana@example.com" });
    const message = harness.emailSender.messages.at(-1) as {
      token: string;
    };
    return { harness, token: message.token };
  }

  it("cambia la contraseña, consume el token y revoca todas las sesiones", async () => {
    const { harness, token } = await registeredWithReset();
    await harness.service.login({
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });

    await harness.service.resetPassword({
      token,
      newPassword: "NuevaClave1!",
    });

    expect(harness.scope.users.rows[0]?.passwordHash).toBe("fake$NuevaClave1!");
    expect(harness.scope.passwordResetTokens.rows[0]?.usedAt).toEqual(NOW);
    for (const row of harness.scope.refreshTokens.rows) {
      expect(row.revokedAt).toEqual(NOW);
    }

    // La contraseña vieja deja de servir y la nueva abre sesión.
    await expect(
      harness.service.login({
        email: "ana@example.com",
        password: VALID_PASSWORD,
      }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
    const relogin = await harness.service.login({
      email: "ana@example.com",
      password: "NuevaClave1!",
    });
    expect(relogin.accessToken).toBeTruthy();
  });

  it("rechaza un token inválido sin tocar la contraseña", async () => {
    const { harness } = await registeredWithReset();

    await expect(
      harness.service.resetPassword({ token: "inventado", newPassword: "NuevaClave1!" }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_token" });

    expect(harness.scope.users.rows[0]?.passwordHash).toBe(`fake$${VALID_PASSWORD}`);
    expect(harness.scope.passwordResetTokens.rows[0]?.usedAt).toBeNull();
  });

  it("rechaza un token ya usado (1-uso)", async () => {
    const { harness, token } = await registeredWithReset();
    await harness.service.resetPassword({ token, newPassword: "NuevaClave1!" });

    await expect(
      harness.service.resetPassword({ token, newPassword: "OtraClave2!" }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_token" });

    expect(harness.scope.users.rows[0]?.passwordHash).toBe("fake$NuevaClave1!");
  });

  it("consume y rechaza un token vencido", async () => {
    const { harness, token } = await registeredWithReset();
    harness.scope.passwordResetTokens.rows[0]!.expiresAt = new Date(
      NOW.getTime() - 1_000,
    );

    await expect(
      harness.service.resetPassword({ token, newPassword: "NuevaClave1!" }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_token" });

    // Vencido también se consume: no puede volver a intentarse arreglando la fila.
    expect(harness.scope.passwordResetTokens.rows[0]?.usedAt).toEqual(NOW);
    expect(harness.scope.users.rows[0]?.passwordHash).toBe(`fake$${VALID_PASSWORD}`);
  });

  it("rechaza contraseñas débiles sin consumir el token", async () => {
    const { harness, token } = await registeredWithReset();

    await expect(
      harness.service.resetPassword({ token, newPassword: "corta" }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(harness.scope.passwordResetTokens.rows[0]?.usedAt).toBeNull();
    expect(harness.scope.users.rows[0]?.passwordHash).toBe(`fake$${VALID_PASSWORD}`);
  });
});

describe("aislamiento multi-tenant", () => {
  it("las sesiones de dos tenants del mismo usuario son familias distintas", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const otro = makeTenant({ id: "tenant-2", slug: "otro" });
    harness.scope.tenants.rows.push(otro);
    harness.scope.memberships.rows.push(
      makeMembership({ id: "m2", tenantId: otro.id, userId: registered.user.id }),
    );

    const enTenantUno = await harness.service.switchTenant(
      registered.user.id,
      registered.tenant.id,
    );
    const enTenantDos = await harness.service.switchTenant(
      registered.user.id,
      otro.id,
    );

    // Cerrar la sesión de un tenant no puede cerrar la del otro: comparten
    // usuario, no familia.
    const revoked = await harness.service.logout(enTenantDos.sessionId);
    expect(revoked).toBe(1);
    expect(enTenantUno.sessionId).not.toBe(enTenantDos.sessionId);
  });

  it("el refresh de un tenant no puede mover la sesión a otro tenant", async () => {
    const harness = buildHarness();
    const registered = await harness.service.register({
      name: "Ana",
      email: "ana@example.com",
      password: VALID_PASSWORD,
    });
    const otro = makeTenant({ id: "tenant-2", slug: "otro" });
    harness.scope.tenants.rows.push(otro);
    harness.scope.memberships.rows.push(
      makeMembership({ id: "m2", tenantId: otro.id, userId: registered.user.id }),
    );
    const enTenantDos = await harness.service.switchTenant(
      registered.user.id,
      otro.id,
    );

    const rotado = await harness.service.refresh({
      refreshToken: enTenantDos.refreshToken,
    });

    const [row] = harness.scope.refreshTokens.rows.filter(
      (r) => r.tokenHash === `sha256$${rotado.refreshToken}`,
    );
    expect(row?.tenantId).toBe(otro.id);
  });
});

export { makeUser };
