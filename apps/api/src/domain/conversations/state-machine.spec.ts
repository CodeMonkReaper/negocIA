import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../errors";
import {
  applyTransition,
  assertValidTransition,
  canTransition,
} from "./state-machine";

describe("máquina de estados de conversación", () => {
  it("acepta el recorrido BOT_ACTIVE → HUMAN_REQUESTED → HUMAN_ACTIVE", () => {
    expect(canTransition("BOT_ACTIVE", "HUMAN_REQUESTED")).toBe(true);
    expect(canTransition("HUMAN_REQUESTED", "HUMAN_ACTIVE")).toBe(true);
  });

  it("permite devolver el control al bot desde HUMAN_ACTIVE", () => {
    expect(canTransition("HUMAN_ACTIVE", "BOT_ACTIVE")).toBe(true);
  });

  it("permite cerrar desde cualquier estado activo y reabrir desde CLOSED", () => {
    for (const from of ["BOT_ACTIVE", "HUMAN_REQUESTED", "HUMAN_ACTIVE"] as const) {
      expect(canTransition(from, "CLOSED")).toBe(true);
    }
    expect(canTransition("CLOSED", "BOT_ACTIVE")).toBe(true);
  });

  it("rechaza subir un nivel que no existe: CLOSED no se cierra otra vez", () => {
    expect(canTransition("CLOSED", "HUMAN_REQUESTED")).toBe(false);
    expect(canTransition("CLOSED", "HUMAN_ACTIVE")).toBe(false);
  });

  it("rechaza saltarse HUMAN_REQUESTED para ir de BOT_ACTIVE a HUMAN_ACTIVE", () => {
    expect(canTransition("BOT_ACTIVE", "HUMAN_ACTIVE")).toBe(false);
  });

  it("rechaza transiciones a un mismo estado (no-op)", () => {
    expect(canTransition("BOT_ACTIVE", "BOT_ACTIVE")).toBe(false);
    expect(canTransition("HUMAN_ACTIVE", "HUMAN_ACTIVE")).toBe(false);
  });

  it("assertValidTransition lanza InvalidTransitionError con from/to en detalles", () => {
    expect(() => assertValidTransition("BOT_ACTIVE", "HUMAN_ACTIVE")).toThrow(
      InvalidTransitionError,
    );
    try {
      assertValidTransition("BOT_ACTIVE", "HUMAN_ACTIVE");
      throw new Error("debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).details).toEqual({
        from: "BOT_ACTIVE",
        to: "HUMAN_ACTIVE",
      });
      expect((error as InvalidTransitionError).status).toBe(409);
      expect((error as InvalidTransitionError).code).toBe("conflict");
    }
  });

  it("applyTransition devuelve el destino si la transición es válida", () => {
    expect(applyTransition("BOT_ACTIVE", "HUMAN_REQUESTED")).toBe("HUMAN_REQUESTED");
  });

  it("el mapa de transiciones cubre todos los estados de dominio", () => {
    const ALL = ["BOT_ACTIVE", "HUMAN_REQUESTED", "HUMAN_ACTIVE", "CLOSED"] as const;
    for (const from of ALL) {
      const targets = applyTransitionCandidates(from);
      for (const to of ALL) {
        if (targets.includes(to)) {
          expect(canTransition(from, to)).toBe(true);
        } else {
          expect(canTransition(from, to)).toBe(false);
        }
      }
    }
  });
});

function applyTransitionCandidates(
  from: "BOT_ACTIVE" | "HUMAN_REQUESTED" | "HUMAN_ACTIVE" | "CLOSED",
): readonly string[] {
  const table: Record<string, readonly string[]> = {
    BOT_ACTIVE: ["HUMAN_REQUESTED", "CLOSED"],
    HUMAN_REQUESTED: ["HUMAN_ACTIVE", "BOT_ACTIVE", "CLOSED"],
    HUMAN_ACTIVE: ["CLOSED", "BOT_ACTIVE"],
    CLOSED: ["BOT_ACTIVE"],
  };
  return table[from];
}