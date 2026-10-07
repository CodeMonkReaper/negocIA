/**
 * Normalización de email (docs/architecture/authentication.md §8, paso 2).
 *
 * El esquema almacena `users.email` como `text` con UNIQUE + índice único en
 * `lower(email)` (migración `identity_core`). La normalización a minúsculas y
 * sin espacios en la aplicación hace redundante esa segunda red y evita que
 * "Ana@X.cl" y "ana@x.cl " creen dos cuentas.
 */

/** Límite RFC 5321 para la parte de dominio de una dirección. */
export const MAX_EMAIL_LENGTH = 254;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `true` si el email ya está normalizado.
 *
 * Se usa antes de escribir para no confiar en que el DTO aplicó la
 * transformación: la normalización es una invariante de persistencia.
 */
export function isNormalizedEmail(email: string): boolean {
  return email === normalizeEmail(email) && email.length <= MAX_EMAIL_LENGTH;
}
