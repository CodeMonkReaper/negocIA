import * as argon2 from "argon2";
import type { PasswordHasher } from "../../domain/ports/password-hasher";

/**
 * Parámetros de Argon2id (OWASP Password Storage Cheat Sheet: m=19 MiB,
 * t=2, p=1 es el perfil mínimo recomendado para hoy).
 *
 * Configurables por entorno porque un servidor con 512 MB de RAM no puede
 * permitirse 19 MiB por hash concurrente; el valor por defecto está elegido
 * para el perfil de Railway/Cloudflare del MVP.
 */
export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength?: number;
}

export const DEFAULT_ARGON2_OPTIONS: Argon2Options = Object.freeze({
  memoryCost: 19456, // KiB → 19 MiB
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options: Argon2Options;

  constructor(options: Partial<Argon2Options> = {}) {
    this.options = { ...DEFAULT_ARGON2_OPTIONS, ...options };
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.options.memoryCost,
      timeCost: this.options.timeCost,
      parallelism: this.options.parallelism,
      hashLength: this.options.hashLength ?? DEFAULT_ARGON2_OPTIONS.hashLength,
    });
  }

  /**
   * Nunca lanza: un hash corrupto o de otro esquema (bcrypt heredado, fila
   * truncada) devuelve `false` en lugar de propagar el error.
   *
   * Un throw aquí convertiría un problema de datos en un 500 que además
   * distingue "usuario con hash raro" de "contraseña incorrecta", que es
   * justamente la fuga que el anti-enumeración de login evita.
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
