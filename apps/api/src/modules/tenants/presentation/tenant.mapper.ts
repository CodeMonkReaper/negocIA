import type {
  CurrentTenantDto,
  TenantUserDto,
  UpdateTenantUserResponseDto,
} from "@negocia/contracts";
import type { TenantRecord } from "../../../domain/identity/entities";
import type { Role } from "../../../domain/identity/roles";
import type { TenantUserRow } from "../application/tenant-users.service";

/**
 * `GET/PATCH /tenants/current`: proyección del tenant activo.
 *
 * Es `CurrentTenantDto` para ambos verbos (el PATCH devuelve el estado nuevo
 * completo, no un parche).
 */
export function toCurrentTenantDto(tenant: TenantRecord): CurrentTenantDto {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    status: tenant.status as CurrentTenantDto["status"],
    createdAt: tenant.createdAt.toISOString(),
  };
}

/**
 * `id` es el de **usuario**, no el de membresía: `PATCH /users/:userId` §9.2
 * direcciona por `userId`, y devolver el `membershipId` invitaría al front a
 * usarlo por error en la URL de edición.
 *
 * Proyección explícita, campo a campo: la fila no viaja por HTTP tal cual, y
 * enumerar evita que un cambio futuro en la consulta (p. ej. añadir `passwordHash`
 * al select) se cuele en la respuesta.
 */
export function toTenantUserDto(member: TenantUserRow): TenantUserDto {
  return {
    id: member.user.id,
    email: member.user.email,
    name: member.user.name,
    role: member.role as Role,
    status: member.user.status,
    emailVerifiedAt: member.user.emailVerifiedAt?.toISOString() ?? null,
    membershipStatus: member.status,
    createdAt: member.user.createdAt.toISOString(),
  };
}

/** Respuesta de `PATCH /users/:userId`: solo los campos que cambian, más el id. */
export function toUpdateTenantUserDto(result: {
  userId: string;
  role: Role;
  status: string;
}): UpdateTenantUserResponseDto {
  return {
    userId: result.userId,
    role: result.role,
    status: result.status,
  };
}