import type {
  MembershipStatus,
  Role,
  TenantStatus,
  UserStatus,
} from "./identity";

/**
 * Perfil de usuario tal como viaja por la API.
 *
 * Regla que no se negocia: ningún DTO expone `passwordHash`. Si algún día
 * alguien añade un campo de credencial aquí, el error no lo detecta TypeScript
 * porque `UserProfile` es una proyección explícita; depende de que cada
 * mapper siga enumerando los campos a mano (PROJECT_CONTEXT §22).
 */
export interface UserProfileDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus | string;
  /** ISO 8601. `null` hasta que se verifique el email. */
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface TenantSummaryDto {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: TenantStatus | string;
}

export interface MembershipDto {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
  status: MembershipStatus | string;
}

/** Membresía con el tenant desnormalizado, para el switch del front. */
export interface MembershipListItemDto {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: Role | string;
  status: MembershipStatus | string;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  /** Segundos de validez del access token. */
  expiresIn: number;
  /** `jti` del access token = ancla de la familia de refresh tokens. */
  sessionId: string;
}

/** Respuesta de `POST /v1/auth/register`, `login` y `switch-tenant`. */
export interface AuthSessionDto extends AuthTokensDto {
  user: UserProfileDto;
  tenant: TenantSummaryDto;
  membership: MembershipDto;
}

/** Respuesta de `POST /v1/auth/refresh`. */
export type RefreshResponseDto = AuthTokensDto;

export type LoginResponseDto = AuthSessionDto;
export type SwitchTenantResponseDto = AuthSessionDto;

/** Respuesta de `GET /v1/me`. */
export interface MeResponseDto {
  user: UserProfileDto;
  currentTenant: TenantSummaryDto;
  membership: MembershipDto;
  memberships: MembershipListItemDto[];
}
