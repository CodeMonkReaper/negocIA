import type {
  CreatePasswordResetTokenInput,
  PasswordResetTokenRecord,
} from "../identity/entities";

/**
 * Puerto de acceso a `password_reset_tokens` (tabla **system-scoped**).
 *
 * Token de un solo uso para restablecer la contraseña (F2-2, ADR-009). Espejo
 * deliberado de `verification_tokens`: mismo ciclo de vida (1-uso, hash,
 * expiración), pero dominio distinto, por eso ADR-008 mantiene tablas
 * separadas y unifica recién a partir de 4 tipos de token.
 */
export interface PasswordResetTokenRepository {
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  create(input: CreatePasswordResetTokenInput): Promise<PasswordResetTokenRecord>;
  /** Consume el token (1-uso). `false` si ya estaba usado. */
  markUsed(id: string, usedAt: Date): Promise<boolean>;
  /** Invalida los tokens pendientes del usuario (nuevo reset o cambio de password). */
  invalidatePendingByUser(userId: string, at: Date): Promise<number>;
}