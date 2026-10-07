import { Injectable } from "@nestjs/common";
import type { InvitationRecord } from "../../../domain/identity/entities";
import type {
  CreateInvitationInput,
  InvitationRepository,
} from "../../../domain/ports/invitation-repository";
import type { Db } from "./prisma-user.repository";

/**
 * Adaptador Prisma de `invitations`.
 *
 * Las transiciones (`consume`, `revoke`, `markExpired`) usan `updateMany` con el
 * estado anterior en el `where`, no `update` con un chequeo previo. La
 * diferencia es la que hace que el token sea de un solo uso bajo concurrencia:
 * con `updateMany`, PostgreSQL bloquea la fila y reevalúa el `where` tras el
 * `LOCK`, así que la segunda transacción de dos aceptaciones simultáneas obtiene
 * `count === 0`. Un `find` seguido de `update` dejaría pasar a las dos.
 */
function toInvitationRecord(row: {
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
}): InvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    tokenHash: row.tokenHash,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    acceptedBy: row.acceptedBy,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<InvitationRecord | null> {
    const row = await this.db.invitation.findUnique({ where: { id } });
    return row ? toInvitationRecord(row) : null;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<InvitationRecord | null> {
    const row = await this.db.invitation.findUnique({ where: { tokenHash } });
    return row ? toInvitationRecord(row) : null;
  }

  async findPendingByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<InvitationRecord | null> {
    const row = await this.db.invitation.findFirst({
      where: { tenantId, email, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return row ? toInvitationRecord(row) : null;
  }

  /**
   * Soporte de la expiración perezosa (ADR-008).
   *
   * Existe para que el caso de uso pueda limpiar las que encuentra al listar, no
   * porque haya endpoint de listado en Fase 1: hoy la consumen `accept` y
   * `create` para no dejar tokens vencidos ocupando el índice parcial
   * `(tenant_id, email) WHERE status='PENDING'`, que es lo que bloquea una
   * re-invitación al mismo email.
   */
  async listExpiredPending(
    tenantId: string,
    now: Date,
  ): Promise<InvitationRecord[]> {
    const rows = await this.db.invitation.findMany({
      where: { tenantId, status: "PENDING", expiresAt: { lte: now } },
    });
    return rows.map(toInvitationRecord);
  }

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    const row = await this.db.invitation.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        tenantId: input.tenantId,
        email: input.email,
        role: input.role,
        invitedBy: input.invitedBy,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
    return toInvitationRecord(row);
  }

  /**
   * Consumo de un solo uso: `status: "PENDING"` en el `where` hace que un
   * segundo intento con el mismo token afecte a `count === 0` en lugar de
   * re-consumirlo, incluso con dos peticiones simultáneas.
   */
  async consume(
    id: string,
    accepted: { acceptedAt: Date; acceptedBy: string },
  ): Promise<boolean> {
    const result = await this.db.invitation.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "ACCEPTED",
        acceptedAt: accepted.acceptedAt,
        acceptedBy: accepted.acceptedBy,
      },
    });
    return result.count === 1;
  }

  async revoke(id: string, revokedAt: Date): Promise<boolean> {
    const result = await this.db.invitation.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REVOKED", revokedAt },
    });
    return result.count === 1;
  }

  /** Idempotente: solo las `PENDING` pasan a `EXPIRED`. */
  async markExpired(id: string): Promise<boolean> {
    const result = await this.db.invitation.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return result.count === 1;
  }
}
