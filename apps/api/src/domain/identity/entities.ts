import type { InvitationStatus, MembershipStatus } from "./statuses";
import type { Role } from "./roles";
import type { Plan } from "../plans";

/**
 * Registros de identidad tal como los expone la capa de persistencia.
 *
 * Son tipos planos, deliberadamente **no** los modelos de Prisma: la capa de
 * aplicación depende de estas formas y los adaptadores de infraestructura
 * hacen la traducción (dependency-rules.md §2/§5). Así un test puede usar
 * dobles en memoria sin conocer el ORM.
 */
export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  /** Ancla de la familia: id de la fila raíz (auth.md §6). */
  sessionId: string;
  /**
   * Tenant en el que se emitió el token.
   *
   * Sin esta columna, renovar con el refresh token cuando el access ya caducó
   * no podría reconstruir el `tenant_id` del claim: la fila de la familia no
   * guarda el tenant, solo el `userId`. Se escribe una vez en la fila raíz y
   * se copia a cada sucesor.
   */
  tenantId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface VerificationTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface InvitationRecord {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  invitedBy: string;
  tokenHash: string;
  status: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Tenant + membership del mismo usuario: la vista que necesita el guard. */
export interface PrincipalMembership extends MembershipRecord {
  tenant: TenantRecord;
}

export interface InvitationWithTenant extends InvitationRecord {
  tenant: Pick<TenantRecord, "id" | "slug" | "name">;
}

export interface CreateUserInput {
  id?: string;
  email: string;
  passwordHash: string;
  name: string;
  status?: string;
}

export interface CreateTenantInput {
  id?: string;
  slug: string;
  name: string;
  plan?: string;
}

export interface CreateMembershipInput {
  id?: string;
  tenantId: string;
  userId: string;
  role: string;
  status?: string;
}

export interface CreateRefreshTokenInput {
  id?: string;
  userId: string;
  /** Ancla de la familia. En la fila raíz es igual a `id`. */
  sessionId: string;
  /** Tenant en el que se emite el token; se propaga a cada sucesor. */
  tenantId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}

export interface CreateVerificationTokenInput {
  id?: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface CreatePasswordResetTokenInput {
  id?: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export type { InvitationStatus, MembershipStatus, Plan, Role };
