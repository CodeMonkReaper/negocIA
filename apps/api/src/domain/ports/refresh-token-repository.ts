import type {
  CreateRefreshTokenInput,
  RefreshTokenRecord,
} from "../identity/entities";

/**
 * Puerto de acceso a `refresh_tokens` (tabla **system-scoped**: sin políticas
 * de tenant en RLS, ADR-006 §1.5).
 *
 * Solo se guarda el hash SHA-256 del token (authentication.md §5): si alguien
 * lee la tabla, no puede suplantar sesiones. `sessionId` ancla la familia
 * completa (fila raíz + descendientes por `replaced_by_token_id`).
 */
export interface RefreshTokenRepository {
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;

  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;

  /**
   * Revoca un token **solo si sigue activo**.
   *
   * `updateMany` con `revokedAt: null` en el `where` es el guard de
   * concurrencia de la rotación: dos requests de refresh simultáneos con el
   * mismo token compiten por la fila y solo uno obtiene `count === 1`. Es la
   * versión con `findFirst` + `update` sin condición de carrera (el
   * check-then-act del PROJECT_CONTEXT §17).
   */
  revokeIfActive(
    id: string,
    revokedAt: Date,
    replacedById?: string,
  ): Promise<boolean>;

  /** Revoca toda la familia (`sessionId`) que aún esté viva. */
  revokeFamily(sessionId: string, revokedAt: Date): Promise<number>;

  /** Revoca todas las familias vivas del usuario (`POST /auth/revoke-all`). */
  revokeAllForUser(userId: string, revokedAt: Date): Promise<number>;

  listActiveByUser(userId: string): Promise<RefreshTokenRecord[]>;

  countActiveByUser(userId: string): Promise<number>;
}
