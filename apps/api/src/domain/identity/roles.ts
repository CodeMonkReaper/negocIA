/**
 * Roles de membresía dentro de un tenant (docs/architecture/authentication.md §9).
 *
 * Fuente de verdad: `memberships.role` en PostgreSQL. El JWT nunca transporta
 * el rol (ADR-005), por lo que estos valores son la única autoridad de
 * autorización y deben coincidir con el CHECK `memberships_role_check`.
 */
export const ROLES = ["OWNER", "ADMIN", "AGENT"] as const;

export type Role = (typeof ROLES)[number];

/** Jerarquía de privilegios: OWNER > ADMIN > AGENT. */
export const ROLE_RANK: Readonly<Record<Role, number>> = Object.freeze({
  OWNER: 3,
  ADMIN: 2,
  AGENT: 1,
});

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Resuelve un rol desconocido/nullish a `AGENT` (rol de menor privilegio).
 *
 * Fallar hacia el menor privilegio es la única dirección segura: ante un
 * valor corrupto en BD o un rol retirado en una futura migración, el usuario
 * no debe obtener más permisos de los que le corresponden.
 */
export function resolveRole(value: unknown): Role {
  return isRole(value) ? value : "AGENT";
}

/** `true` si `role` tiene al menos el privilegio de `minimum`. */
export function hasAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Roles que un miembro con rol `actor` puede invitar (matriz de invitación).
 *
 * La regla no admite escalada de privilegios: un `ADMIN` no puede crear otro
 * `OWNER` (autoascenso por invitación); solo un `OWNER` puede legar/promover a
 * `OWNER`. `AGENT` no invita (lo refuerza `@Roles` en el controller).
 */
export const INVITABLE_ROLES: Readonly<Record<Role, readonly Role[]>> =
  Object.freeze({
    OWNER: ["OWNER", "ADMIN", "AGENT"],
    ADMIN: ["ADMIN", "AGENT"],
    AGENT: [],
  });

/** `true` si `actor` puede invitar con el rol `target`. */
export function canInviteRole(actor: Role, target: Role): boolean {
  return (INVITABLE_ROLES[actor] as readonly Role[]).includes(target);
}
