import { describe, expect, it } from "vitest";
import { LimitsService } from "./limits-service";
import { DEFAULT_PLAN, PLAN_CATALOG } from "./plan-catalog";

function createService(): LimitsService {
  return new LimitsService();
}

describe("LimitsService", () => {
  it("devuelve los límites de cada plan del catálogo", () => {
    const service = createService();

    expect(service.getLimits("BASIC")).toEqual(PLAN_CATALOG.BASIC);
    expect(service.getLimits("PRO")).toEqual(PLAN_CATALOG.PRO);
    expect(service.getLimits("PREMIUM")).toEqual(PLAN_CATALOG.PREMIUM);
  });

  it("resuelve planes desconocidos/ausentes al plan por defecto (BASIC)", () => {
    const service = createService();

    expect(service.getLimits("ENTERPRISE")).toEqual(PLAN_CATALOG[DEFAULT_PLAN]);
    expect(service.getLimits(undefined)).toEqual(PLAN_CATALOG[DEFAULT_PLAN]);
    expect(service.getLimits(null)).toEqual(PLAN_CATALOG[DEFAULT_PLAN]);
  });

  it("acepta llegar hasta el límite sin lanzar (boundary inclusivo)", () => {
    const service = createService();

    expect(() => service.assertUnderLimit(0, "maxUsers", "BASIC")).not.toThrow();
    expect(() => service.assertUnderLimit(1, "maxUsers", "BASIC")).not.toThrow();
  });

  it("lanza ConflictError con detalles cuando el límite se supera", () => {
    const service = createService();

    expect(() => service.assertUnderLimit(2, "maxUsers", "BASIC")).toThrow(
      /Límite del plan superado/,
    );

    try {
      service.assertUnderLimit(10, "maxUsers", "PRO");
      throw new Error("debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("usa el límite del plan resuelto (no del string crudo)", () => {
    const service = createService();

    expect(() =>
      service.assertUnderLimit(10, "maxUsers", "ENTERPRISE"),
    ).toThrow(/Límite del plan superado/);
    expect(() =>
      service.assertUnderLimit(1, "maxUsers", "ENTERPRISE"),
    ).not.toThrow();
  });
});