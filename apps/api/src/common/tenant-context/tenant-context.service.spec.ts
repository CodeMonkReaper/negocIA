import { describe, expect, it } from "vitest";
import { TenantContextService } from "./tenant-context.service";

/**
 * El `AsyncLocalStorage` es la base del aislamiento multi-tenant: si el
 * contexto se pierde o se filtra entre peticiones, una consulta puede acabar
 * leyendo datos de otra empresa. Estos casos fijan el comportamiento que
 * depende de él.
 */
describe("TenantContextService", () => {
  const service = new TenantContextService();

  const tenantA = {
    tenantId: "tenant-a",
    userId: "user-1",
    role: "OWNER" as const,
    source: "HTTP_JWT" as const,
    sessionId: "session-a",
  };

  it("el contexto solo existe dentro de run()", () => {
    expect(service.getContext()).toBeUndefined();

    service.run(tenantA, () => {
      expect(service.requireTenantId()).toBe("tenant-a");
    });

    // Fuera del run, no hay contexto heredado: nada se filtra a la siguiente
    // operación.
    expect(service.getContext()).toBeUndefined();
  });

  it("requireContext() falla en vez de devolver un tenant por defecto", () => {
    // Fallar es lo seguro: "sin tenant, todo tenant" sería una fuga de datos
    // entre empresas.
    expect(() => service.requireContext()).toThrowError(
      /No hay TenantContext/,
    );
    expect(() => service.requireTenantId()).toThrow();
  });

  it("el contexto sobrevive a los awaits internos", async () => {
    await service.run(tenantA, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(service.requireTenantId()).toBe("tenant-a");
      await Promise.all([
        (async () => {
          await new Promise((resolve) => setImmediate(resolve));
          expect(service.requireTenantId()).toBe("tenant-a");
        })(),
      ]);
    });
  });

  it("dos run() anidados no se pisan al salir el interno", async () => {
    const tenantB = { ...tenantA, tenantId: "tenant-b" };

    await service.run(tenantA, async () => {
      await service.run(tenantB, async () => {
        expect(service.requireTenantId()).toBe("tenant-b");
      });
      // Al salir el run interno se restaura el externo, no `undefined`.
      expect(service.requireTenantId()).toBe("tenant-a");
    });
  });

  it("dos run() concurrentes mantienen contextos separados", async () => {
    // Es el caso real con dos peticiones HTTP simultáneas: sin
    // AsyncLocalStorage, un `store` global compartido Cruzaría tenants.
    const tenantB = { ...tenantA, tenantId: "tenant-b" };
    const seen: string[] = [];

    await Promise.all([
      service.run(tenantA, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push(service.requireTenantId());
      }),
      service.run(tenantB, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(service.requireTenantId());
      }),
    ]);

    expect(seen.sort()).toEqual(["tenant-a", "tenant-b"]);
    expect(service.getContext()).toBeUndefined();
  });

  it("requireRole degrada a error si no hay rol", () => {
    expect(() =>
      service.run({ ...tenantA, role: null }, () => service.requireRole()),
    ).toThrowError(/no tiene rol/);
  });

  it("satisfiesRole aplica la jerarquía", () => {
    service.run(tenantA, () => {
      expect(service.satisfiesRole("AGENT")).toBe(true);
      expect(service.satisfiesRole("ADMIN")).toBe(true);
      expect(service.satisfiesRole("OWNER")).toBe(true);
    });

    service.run({ ...tenantA, role: "AGENT" }, () => {
      expect(service.satisfiesRole("AGENT")).toBe(true);
      expect(service.satisfiesRole("ADMIN")).toBe(false);
      expect(service.satisfiesRole("OWNER")).toBe(false);
    });
  });

  it("satisfiesRole es false sin contexto (fail-closed)", () => {
    // Un guard que por defecto permite sería un fallo de autorización
    // silencioso.
    expect(service.satisfiesRole("AGENT")).toBe(false);
  });
});
