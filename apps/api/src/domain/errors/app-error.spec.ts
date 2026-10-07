import { describe, expect, it } from "vitest";
import { API_ERROR_CODES } from "@negocia/contracts";
import { DOMAIN_ERROR_CODES } from "./app-error";

/**
 * Paridad runtime entre el catálogo del dominio y el wire (Fase 1, M-5).
 *
 * `AllExceptionsFilter` lanza los códigos de dominio como `ApiErrorCode` con
 * una aserción de tipo que el compilador no verifica: si el dominio ganara un
 * error nuevo y contracts no lo reflejara, un cliente recibiría en runtime un
 * `code` que no reconoce y todo seguiría compilando.
 *
 * A diferencia de la transcripción manual que vive en `packages/contracts`
 * (que no puede depender de `apps/api` por la dirección de sus dependencias),
 * aquí la fuente de verdad `DOMAIN_ERROR_CODES` se compara contra el catálogo
 * real: sin copias intermedias que se puedan quedar atrás.
 */
describe("paridad DomainErrorCode ↔ API_ERROR_CODES", () => {
  it("el dominio y el wire tienen exactamente los mismos códigos", () => {
    expect([...DOMAIN_ERROR_CODES]).toEqual([...API_ERROR_CODES]);
  });

  it("el orden coincide: el wire espía derivas del dominio", () => {
    expect([...DOMAIN_ERROR_CODES]).toContain("invalid_token");
    expect(new Set(DOMAIN_ERROR_CODES).size).toBe(DOMAIN_ERROR_CODES.length);
  });
});