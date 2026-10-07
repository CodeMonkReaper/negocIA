import type {
  CreateVerificationTokenInput,
  VerificationTokenRecord,
} from "../identity/entities";

/**
 * Puerto de acceso a `verification_tokens` (tabla **system-scoped**).
 *
 * Token de un solo uso para verificar el email: se entrega por `EmailSender`
 * y se consume en Fase 5 (`POST /v1/email-verification/verify`).
 */
export interface VerificationTokenRepository {
  findByTokenHash(tokenHash: string): Promise<VerificationTokenRecord | null>;
  create(input: CreateVerificationTokenInput): Promise<VerificationTokenRecord>;
  /** Consume el token (1-uso). `false` si ya estaba usado. */
  markUsed(id: string, usedAt: Date): Promise<boolean>;
  /** Invalida los tokens pendientes del usuario (reenvío). */
  invalidatePendingByUser(userId: string, at: Date): Promise<number>;
}
