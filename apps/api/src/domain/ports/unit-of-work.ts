import type { InvitationRepository } from "./invitation-repository";
import type { MembershipRepository } from "./membership-repository";
import type { PasswordResetTokenRepository } from "./password-reset-token-repository";
import type { RefreshTokenRepository } from "./refresh-token-repository";
import type { TenantRepository } from "./tenant-repository";
import type { UserRepository } from "./user-repository";
import type { VerificationTokenRepository } from "./verification-token-repository";

/**
 * Repositorios disponibles dentro de una transacción.
 *
 * Se entregan ya vinculados a la transacción: el caso de uso nunca ve el
 * cliente de Prisma, así que no puede escapar del ámbito transaccional por
 * descuido.
 */
export interface TransactionScope {
  users: UserRepository;
  tenants: TenantRepository;
  memberships: MembershipRepository;
  refreshTokens: RefreshTokenRepository;
  verificationTokens: VerificationTokenRepository;
  passwordResetTokens: PasswordResetTokenRepository;
  invitations: InvitationRepository;
}

/**
 * Unit of work.
 *
 * Existe porque varios casos de uso necesitan atomicidad y la capa de
 * aplicación no debe conocer el gestor de transacciones:
 *
 * - `register`: user + tenant + membership(OWNER) atómicos. Si el tenant
 *   colisiona en el slug o el email ya existe, no debe quedar un usuario
 *   huérfano sin tenant.
 * - `refresh`: crear el token successor y revocar el predecesor en la misma
 *   transacción, para que una rotación nunca deje la familia sin cobertura.
 * - `acceptInvitation`: consumir la invitación, crear la membresía y verificar
 *   el email son una sola operación. Aceptada sin membresía dejaría un token de
 *   un solo uso consumido sin efecto, que es irrecuperable.
 */
export interface UnitOfWork {
  transaction<T>(fn: (scope: TransactionScope) => Promise<T>): Promise<T>;
}
