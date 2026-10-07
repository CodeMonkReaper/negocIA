/**
 * Estados de las entidades de identidad.
 *
 * Cada lista replica una constraint CHECK de la migración `identity_core`
 * (`migration.sql:168-190`). La aplicación debe mantener ambas copias
 * sincronizadas: el CHECK protege la integridad, estas uniones dan tipado.
 */
export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INVITATION_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "EXPIRED",
  "REVOKED",
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export function isTenantStatus(value: unknown): value is TenantStatus {
  return (
    typeof value === "string" &&
    (TENANT_STATUSES as readonly string[]).includes(value)
  );
}

export function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === "string" &&
    (USER_STATUSES as readonly string[]).includes(value)
  );
}

export function isMembershipStatus(
  value: unknown,
): value is MembershipStatus {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_STATUSES as readonly string[]).includes(value)
  );
}
