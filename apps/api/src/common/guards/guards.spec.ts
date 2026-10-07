import { describe, expect, it } from "vitest";
import { createInMemoryScope, makeTenant } from "../../testing/in-memory/fakes";
import { TenantContextService } from "../tenant-context/tenant-context.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { TenantContextGuard } from "./tenant-context.guard";
import { Public } from "./public.decorator";
import { Roles } from "./roles.decorator";

/**
 * Guards sin Nest: se prueban como clases con un `ExecutionContext` mínimo.
 *
 * Montar la aplicación entera para comprobar una regla de autorización
 * esconde justo lo que se quiere verificar (qué consulta se hizo, con qué
 * datos) detrás de la infraestructura HTTP.
 */
function httpContext(request: Record<string, unknown>): {
  getHandler: () => unknown;
  getClass: () => unknown;
  switchToHttp: () => { getRequest: () => Record<string, unknown> };
} {
  return {
    getHandler: () => handlerRef,
    getClass: () => classRef,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

class ReflectorStub {
  constructor(private readonly map = new Map<unknown, unknown>()) {}
  get<T>(key: string, _target?: unknown): T | undefined {
    return this.map.get(key) as T | undefined;
  }
  getAllAndOverride<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
}

const handlerRef = function handler(): void {};
class classRef {}

describe("JwtAuthGuard", () => {
  const claims = {
    sub: "user-1",
    jti: "session-1",
    tenant_id: "tenant-1",
    iss: "negocia-api",
    aud: "negocia-clients",
    iat: 1,
    exp: 2,
  };

  function buildGuard(verify: (token: string) => Promise<typeof claims>) {
    return new JwtAuthGuard(
      { issue: async () => "", verify } as never,
      new ReflectorStub() as never,
    );
  }

  it("adjunta los claims verificados a la request", async () => {
    const guard = buildGuard(async () => claims);
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer abc.def.ghi" },
    };

    await guard.canActivate(httpContext(request) as never);

    expect(request.authClaims).toEqual(claims);
  });

  it("acepta el esquema Bearer sin distinguir mayúsculas", async () => {
    const guard = buildGuard(async () => claims);
    const request: Record<string, unknown> = {
      headers: { authorization: "bearer abc" },
    };

    await guard.canActivate(httpContext(request) as never);
    expect(request.authClaims).toBeTruthy();
  });

  it.each([
    ["sin cabecera", undefined],
    ["cabecera vacía", ""],
    ["otro esquema", "Basic dXNlcjpwYXNz"],
    ["sin token", "Bearer "],
    ["dos tokens", "Bearer a b"],
  ])("rechaza %s con 401", async (_caso, authorization) => {
    const guard = buildGuard(async () => claims);
    const request: Record<string, unknown> = {
      headers: { authorization },
    };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("deja pasar las rutas públicas sin token", async () => {
    const reflector = new ReflectorStub();
    reflector.set("auth:public", true);
    const guard = new JwtAuthGuard(
      {
        issue: async () => "",
        verify: async () => {
          throw new Error("no debería verificar");
        },
      } as never,
      reflector as never,
    );

    const request: Record<string, unknown> = { headers: {} };
    await expect(
      guard.canActivate(httpContext(request) as never),
    ).resolves.toBe(true);
  });

  it("propaga el error del verificador sin reinterpretarlo", async () => {
    // El guard no traduce errores: `JwtAccessTokenIssuer.verify` ya colapsa
    // todos los fallos de `jose` en un único 401. Si el guard los tradujera
    // otra vez, se duplicaría la lógica de redacción y bastaría un mensaje
    // distinto en un sitio para filtrar el motivo real.
    const guard = buildGuard(async () => {
      throw new Error("firma inválida");
    });
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer abc" },
    };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toThrowError("firma inválida");
  });
});

describe("TenantContextGuard", () => {
  const claims = {
    sub: "user-1",
    jti: "session-1",
    tenant_id: "tenant-1",
    iss: "negocia-api",
    aud: "negocia-clients",
    iat: 1,
    exp: 2,
  };

  function build(scope: ReturnType<typeof createInMemoryScope>) {
    return new TenantContextGuard(
      scope.users,
      scope.memberships,
      scope.tenants,
      new ReflectorStub() as never,
    );
  }

  async function seed(scope: ReturnType<typeof createInMemoryScope>) {
    const user = await scope.users.create({
      email: "ana@example.com",
      passwordHash: "h",
      name: "Ana",
    });
    const tenant = await scope.tenants.create({ slug: "ana", name: "Ana" });
    const membership = await scope.memberships.create({
      tenantId: tenant.id,
      userId: user.id,
      role: "ADMIN",
    });
    return { user, tenant, membership };
  }

  it("resuelve el principal desde BD, no desde el token", async () => {
    const scope = createInMemoryScope();
    const { tenant } = await seed(scope);
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await guard.canActivate(httpContext(request) as never);

    const principal = request.principal as Record<string, string>;
    expect(principal.userId).toBe("user-1");
    expect(principal.role).toBe("ADMIN");
    expect(principal.tenantId).toBe(tenant.id);
    expect(principal.sessionId).toBe("session-1");
    expect(request.tenantContext).toMatchObject({
      tenantId: tenant.id,
      source: "HTTP_JWT",
      sessionId: "session-1",
    });
  });

  it("el rol degradado en BD surte efecto sin esperar al token", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.memberships.rows[0]!.role = "AGENT";
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await guard.canActivate(httpContext(request) as never);

    // El JWT no lleva rol, así que la degradación es visible de inmediato.
    expect((request.principal as { role: string }).role).toBe("AGENT");
  });

  it("rechaza con 403 si la membresía está suspendida", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.memberships.rows[0]!.status = "SUSPENDED";
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toMatchObject({ status: 403, code: "membership_inactive" });
  });

  it("rechaza con 403 si el tenant está suspendido", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.tenants.rows[0]!.status = "SUSPENDED";
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toMatchObject({ status: 403, code: "tenant_inactive" });
  });

  it("rechaza con 403 un tenant del que el usuario no es miembro", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.tenants.rows.push(makeTenant({ id: "tenant-ajeno", slug: "ajeno" }));
    const guard = build(scope);
    const request: Record<string, unknown> = {
      authClaims: { ...claims, tenant_id: "tenant-ajeno" },
    };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toMatchObject({ status: 403, code: "membership_inactive" });
  });

  it("rechaza con 403 una cuenta deshabilitada", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.users.rows[0]!.status = "SUSPENDED";
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await expect(
      guard.canActivate(httpContext(request) as never),
    ).rejects.toMatchObject({ status: 403, code: "account_disabled" });
  });

  it("un rol desconocido degrada a AGENT, nunca a OWNER", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    scope.memberships.rows[0]!.role = "SUPERUSUARIO" as never;
    const guard = build(scope);
    const request: Record<string, unknown> = { authClaims: claims };

    await guard.canActivate(httpContext(request) as never);

    expect((request.principal as { role: string }).role).toBe("AGENT");
  });

  it("falla si no hay claims (cableado incorrecto, no error del cliente)", async () => {
    const scope = createInMemoryScope();
    await seed(scope);
    const guard = build(scope);

    await expect(
      guard.canActivate(httpContext({}) as never),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("RolesGuard", () => {
  function buildGuard(roles: string[] | undefined) {
    const reflector = new ReflectorStub();
    if (roles) {
      reflector.set("auth:roles", roles);
    }
    return new RolesGuard(reflector as never);
  }

  /** Request con el principal que habría dejado `TenantContextGuard`. */
  function requestWithRole(role: string | undefined) {
    return role === undefined ? {} : { principal: { role } };
  }

  it("deja pasar las rutas sin @Roles", () => {
    const guard = buildGuard(undefined);
    expect(guard.canActivate(httpContext({}) as never)).toBe(true);
  });

  it("permite cuando el principal cumple el mínimo", () => {
    const guard = buildGuard(["ADMIN"]);
    expect(
      guard.canActivate(httpContext(requestWithRole("OWNER")) as never),
    ).toBe(true);
  });

  it("rechaza con 403 cuando el rol es insuficiente", () => {
    const guard = buildGuard(["OWNER"]);
    expect(() =>
      guard.canActivate(httpContext(requestWithRole("ADMIN")) as never),
    ).toThrowError(/no permite/);
  });

  it("con varios roles exige el mínimo (semántica jerárquica)", () => {
    // El mínimo de {OWNER, AGENT} es AGENT, así que un ADMIN cumple.
    const guard = buildGuard(["OWNER", "AGENT"]);
    expect(
      guard.canActivate(httpContext(requestWithRole("ADMIN")) as never),
    ).toBe(true);
  });

  it("sin principal responde 403, no 500 ni acceso", () => {
    const guard = buildGuard(["AGENT"]);
    expect(() => guard.canActivate(httpContext({}) as never)).toThrowError();
  });

  /**
   * Regresión del orden real de Nest: **todos** los guards se ejecutan antes
   * que cualquier interceptor, y es el interceptor quien abre el
   * `AsyncLocalStorage`. Si `RolesGuard` leyera el rol del ALS se rechazaría
   * aquí con 403, aunque el usuario fuese OWNER.
   */
  it("no depende del AsyncLocalStorage, que aún no está abierto en los guards", () => {
    const contextService = new TenantContextService();
    const guard = buildGuard(["AGENT"]);

    // El ALS está abierto y **vacío**: es el estado real durante la fase de
    // guards, porque el interceptor todavía no ha corrido.
    contextService.run(
      { tenantId: "t", userId: "u", role: null, source: "HTTP_JWT", sessionId: "s" },
      () => {
        expect(contextService.getContext()?.role).toBeNull();
        expect(
          guard.canActivate(httpContext(requestWithRole("OWNER")) as never),
        ).toBe(true);
      },
    );
  });
});

describe("decoradores", () => {
  it("@Public y @Roles registran sus metadatos", () => {
    class Target {
      @Public()
      @Roles("OWNER")
      handler(): void {}
    }

    const metadata = Reflect.getMetadataKeys(Target.prototype.handler);
    expect(metadata).toContain("auth:public");
    expect(metadata).toContain("auth:roles");
  });
});

