/**
 * Generador de tokens opacos (refresh tokens, invitaciones, verificación de
 * email).
 *
 * "Opaco" significa que el cliente no puede extraer información del token: no
 * lleva `sub` ni `exp` dentro; esos datos viven en la fila de la tabla
 * (`refresh_tokens.expires_at`) y se validan contra ella.
 */
export interface OpaqueTokenGenerator {
  /** Token URL-safe de `bytes` de entropía (por defecto 32 → 43 chars). */
  generate(bytes?: number): string;
}
