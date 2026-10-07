import type {
  AuthSessionDto,
  MembershipDto,
  MeResponseDto,
  TenantSummaryDto,
  UserProfileDto,
} from "@negocia/contracts";
import type {
  MembershipRecord,
  TenantRecord,
  UserRecord,
} from "../../../domain/identity/entities";
import type { AuthMe, AuthSession } from "../application/auth.service";

/**
 * Mapeo dominio → DTO de la capa de presentación.
 *
 * Existe para que el contrato HTTP no dependa de la forma de los records del
 * dominio: si `UserRecord` cambia (o mañana lleva `deletedAt`), el DTO sigue
 * declarando exactamente los campos públicos. También fija fechas a ISO-8601
 * aquí, de modo que el formato del JSON no dependa de cómo Express serialice un
 * `Date`.
 */
export function toUserDto(user: UserRecord): UserProfileDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toTenantDto(tenant: TenantRecord): TenantSummaryDto {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    plan: tenant.plan,
    status: tenant.status,
  };
}

export function toMembershipDto(membership: MembershipRecord): MembershipDto {
  return {
    id: membership.id,
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role as MembershipDto["role"],
    status: membership.status as MembershipDto["status"],
  };
}

export function toAuthSessionDto(session: AuthSession): AuthSessionDto {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    sessionId: session.sessionId,
    user: toUserDto(session.user),
    tenant: toTenantDto(session.tenant),
    membership: toMembershipDto(session.membership),
  };
}

export function toMeDto(me: AuthMe): MeResponseDto {
  return {
    user: toUserDto(me.user),
    currentTenant: toTenantDto(me.currentTenant),
    membership: toMembershipDto(me.membership),
    memberships: me.memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantSlug: m.tenantSlug,
      tenantName: m.tenantName,
      role: m.role,
      status: m.status,
    })),
  };
}
