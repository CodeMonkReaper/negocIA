/**
 * Vocabulario de wire compartido.
 *
 * Estas uniones son la **copia de transporte** de los CHECK de la migración
 * `identity_core`. Los enum del dominio (`apps/api/src/domain/identity`) siguen
 * siendo la autoridad de la aplicación; estas constantes existen para que el
 * front pueda tipar una respuesta sin importar el backend.
 *
 * Por eso se duplican a propósito y no se importan del dominio: si
 * `packages/contracts` dependiera de `apps/api`, el front acabaría arrastrando
 * NestJS. El test `identity-vocabulary.spec.ts` de este paquete verifica que
 * ambas copias no se separen.
 *
 * Los CHECK que replican:
 *  - `memberships_role_check`     → OWNER | ADMIN | AGENT
 *  - `memberships_status_check`   → ACTIVE | INACTIVE
 *  - `users_status_check`         → ACTIVE | DISABLED
 *  - `tenants_status_check`       → ACTIVE | SUSPENDED | CLOSED
 *  - `invitations_status_check`   → PENDING | ACCEPTED | EXPIRED | REVOKED
 */

export const ROLES = ["OWNER", "ADMIN", "AGENT"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "REVOKED",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Identificadores de plan de `packages/plan-catalog`.
 *
 * Se declaran como `string` y no como unión cerrada a propósito: el catálogo
 * vive en el dominio y los planes pueden crecer sin que el front necesite una
 * versión nueva del paquete. Lo que sí se fija aquí son las capacidades que el
 * front lee para condicionar UI.
 */
export interface PlanCapabilities {
  maxUsers: number;
  maxConversationsPerMonth: number;
  llmEnabled: boolean;
  rlsEnabled: boolean;
}
