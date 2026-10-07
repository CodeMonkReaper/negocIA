import { randomBytes, randomUUID } from "node:crypto";
import type { IdGenerator } from "../../domain/ports/id-generator";
import type { OpaqueTokenGenerator } from "../../domain/ports/opaque-token-generator";

/**
 * Generador de tokens opacos sobre `crypto.randomBytes`.
 *
 * 32 bytes = 256 bits de entropía, codificados en base64url (43 caracteres,
 * sin `+`, `/` ni `=`): suficiente para que el token no sea adivinable ni
 * adivinable por fuerza bruta dentro de la ventana de vida del token, y
 * seguro de transportar en JSON y cabeceras.
 */
export class CryptoOpaqueTokenGenerator implements OpaqueTokenGenerator {
  static readonly DEFAULT_BYTES = 32;

  generate(bytes: number = CryptoOpaqueTokenGenerator.DEFAULT_BYTES): string {
    return randomBytes(bytes).toString("base64url");
  }
}

/**
 * UUID v4 para los ids que la aplicación genera (raíz de sesión, etc.).
 *
 * Es la implementación de `IdGenerator`; la función se exporta también suelta
 * por comodidad de los adaptadores, pero la capa de aplicación lo consume
 * **por puerto** para no depender de `node:crypto`.
 */
export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
