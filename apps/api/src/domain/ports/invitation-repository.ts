import type { InvitationRecord } from "../identity/entities";

/** Datos de alta de una invitación. El `tokenHash` ya viene hasheado. */
export interface CreateInvitationInput {
  id?: string;
  tenantId: string;
  email: string;
  role: string;
  invitedBy: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Puerto de acceso a `invitations` (tabla **tenant-scoped**).
 *
 * El token opaco **nunca** sale de este puerto: la aplicación solo recibe
 * `InvitationRecord` con `tokenHash`, y el token en claro existe únicamente en
 * el mensaje de email. Un dump de la base de datos no debe permitir aceptar
 * invitaciones (ADR-008).
 *
 * `consume` es la operación crítica del módulo. Su contrato de concurrencia es
 * deliberadamente estricto: devuelve `true` **solo si esta llamada concreta**
 * realizó la transición, y `false` si la invitación ya no estaba `PENDING`. Eso
 * hace que dos aceptaciones simultáneas del mismo token no puedan tener éxito
 * ambas, que es la propiedad que se necesita para que el token sea de un solo
 * uso.
 */
export interface InvitationRepository {
  findById(id: string): Promise<InvitationRecord | null>;

  /** Búsqueda por hash del token, insensible al tenant: el token es la credencial. */
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;

  /** Invitación `PENDING` de un email en el tenant. Insumo del check de duplicados. */
  findPendingByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<InvitationRecord | null>;

  /** Invitaciones `PENDING` del tenant que ya vencieron (expiración perezosa). */
  listExpiredPending(tenantId: string, now: Date): Promise<InvitationRecord[]>;

  create(input: CreateInvitationInput): Promise<InvitationRecord>;

  /**
   * Transición atómica `PENDING` → `ACCEPTED`.
   *
   * `false` si la fila no estaba `PENDING`. La expiración se comprueba en
   * memoria por el caso de uso, no en el `WHERE`: meter `expires_at > now()`
   * aquí haría que un token vencido devolviera `false` y fuera indistinguible de
   * uno ya usado, y el caso de uso necesita marcarlo `EXPIRED`.
   */
  consume(
    id: string,
    accepted: { acceptedAt: Date; acceptedBy: string },
  ): Promise<boolean>;

  /** `PENDING` → `REVOKED`. `false` si ya no estaba `PENDING`. */
  revoke(id: string, revokedAt: Date): Promise<boolean>;

  /** `PENDING` → `EXPIRED`. Idempotente: solo actúa sobre `PENDING`. */
  markExpired(id: string): Promise<boolean>;
}
