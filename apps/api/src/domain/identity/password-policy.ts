import { ValidationError } from "../errors";

/**
 * Política de contraseñas (Fase 1).
 *
 * Mínima y deliberadamente sin reglas de composición: el usuario objetivo son
 * PyMEs, no un banco. Exigir símbolos yMayúsculas solo produce variantes
 * (`Password1!`) y soporte de tickets; la UCI real la aporta Argon2id.
 *
 * El máximo de 128 caracteres no es cosmetico: Argon2 es intencionadamente
 * lento y el input es la única parte del costo que el atacante controla, así
 * que un máximo acotado evita que un POST /login convierta la API en un
 * amplificador de CPU.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new ValidationError(
      "La contraseña debe tener al menos 8 caracteres",
      { minLength: PASSWORD_MIN_LENGTH },
    );
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new ValidationError(
      "La contraseña supera el máximo de 128 caracteres",
      { maxLength: PASSWORD_MAX_LENGTH },
    );
  }
}
