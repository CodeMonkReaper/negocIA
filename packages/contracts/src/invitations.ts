import type { InvitationStatus, Role, TenantStatus } from "./identity";

/**
 * Invitación a un tenant (docs/api/authentication.md §7).
 *
 * `token` **no aparece** en ninguna respuesta. La invitación se crea con un
 * token opaco que solo viaja al email, y en BD se almacena únicamente su
 * hash SHA-256; incluir el campo aquí habilitaría a cualquier futuro consumer a
 * devolverlo por accidente desde la entidad de Prisma.
 */
export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  /** ISO 8601. */
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
}

/**
 * Respuesta de `POST /v1/invitations/accept`.
 *
 * Devuelve tokens de sesión, no solo metadatos: aceptar una invitación cambia
 * el tenant activo, y el cliente necesita un access token con `tenant_id` del
 * tenant nuevo sin un `switch-tenant` extra. Se extiende `AuthTokensDto` en
 * lugar de envolverlo para que el front destructurice los tokens igual que en
 * login.
 */
export interface AcceptInvitationResponseDto {
  tenantId: string;
  tenantName: string;
  role: Role;
  status: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  /** Segundos de validez del access token. */
  expiresIn: number;
}

/** Respuesta de `POST /v1/email-verification/verify`. */
export interface VerifyEmailResponseDto {
  emailVerifiedAt: string;
}

/**
 * Item de `GET /v1/tenants/:tenantId/users`.
 *
 * Mezcla usuario y membresía a propósito: el endpoint responde a "¿quién está
 * en mi tenant?", y separar las dos entidades obligaría al front a hacer N
 * consultas para pintar una tabla.
 */
export interface TenantUserDto {
  /** `users.id`, no `memberships.id`: el PATCH §9.2 direcciona por `userId`. */
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  emailVerifiedAt: string | null;
  /** `memberships.status`, que puede diferir de `users.status`. */
  membershipStatus: string;
  createdAt: string;
}

/** Respuesta de `GET /v1/tenants/current`. */
export interface CurrentTenantDto {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: TenantStatus | string;
  createdAt: string;
}

/** Respuesta de `PATCH /v1/tenants/current`. */
export type UpdateTenantResponseDto = CurrentTenantDto;

/** Respuesta de `PATCH /v1/tenants/:tenantId/users/:userId`. */
export interface UpdateTenantUserResponseDto {
  userId: string;
  role: Role;
  status: string;
}
