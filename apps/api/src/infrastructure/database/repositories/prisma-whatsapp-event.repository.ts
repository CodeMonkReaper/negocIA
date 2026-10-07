import { Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@negocia/database";
import type {
  CreateWhatsappEventDraft,
  WhatsappEventRecord,
} from "../../../domain/whatsapp/entities";
import type { WhatsappEventRepository } from "../../../domain/ports/whatsapp-event-repository";
import { translatePrismaError } from "./translate-prisma-error";

export type Db = PrismaClient | Prisma.TransactionClient;

function toEventRecord(row: {
  id: string;
  providerEventId: string;
  tenantId: string | null;
  accountId: string | null;
  eventType: string;
  payload: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  processedAt: Date | null;
}): WhatsappEventRecord {
  return {
    id: row.id,
    providerEventId: row.providerEventId,
    tenantId: row.tenantId,
    accountId: row.accountId,
    eventType: row.eventType,
    payload: row.payload,
    status: row.status as WhatsappEventRecord["status"],
    createdAt: row.createdAt,
    processedAt: row.processedAt,
  };
}

/**
 * Adaptador Prisma de `whatsapp_events`.
 *
 * Idempotencia: `provider_event_id` es UNIQUE global, así que la frontera de
 * deduplicación vive en la base, no en "comprobar antes de insertar". `create`
 * detecta el conflicto (P2002) y devuelve `null`: dos copias de un mismo
 * webhook en paralelo producen **un** insert y una carrera que el caso de uso
 * resuelve releyendo la fila ganadora.
 *
 * Las transiciones usan `updateMany` con el status anterior en el `where`
 * (mismo criterio que `prisma-invitation.repository.ts`): la reevaluación del
 * `where` tras el lock de fila hace que una transición concurrente sea no-op.
 */
@Injectable()
export class PrismaWhatsappEventRepository implements WhatsappEventRepository {
  constructor(private readonly db: Db) {}

  async findByProviderEventId(
    providerEventId: string,
  ): Promise<WhatsappEventRecord | null> {
    const row = await this.db.whatsappEvent.findUnique({
      where: { providerEventId },
    });
    return row ? toEventRecord(row) : null;
  }

  /** `null` = carrera: otro proceso insertó el mismo provider_event_id. */
  async create(draft: CreateWhatsappEventDraft): Promise<WhatsappEventRecord | null> {
    try {
      const row = await this.db.whatsappEvent.create({
        data: {
          providerEventId: draft.providerEventId,
          tenantId: draft.tenantId,
          accountId: draft.accountId,
          eventType: draft.eventType,
          payload: draft.payload as Prisma.InputJsonValue,
        },
      });
      return toEventRecord(row);
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return null;
      }
      throw translatePrismaError(error, "whatsapp_events");
    }
  }

  async markEnqueued(id: string): Promise<void> {
    await this.db.whatsappEvent.updateMany({
      where: { id, status: { in: ["RECEIVED", "FAILED"] } },
      data: { status: "ENQUEUED" },
    });
  }

  async markProcessed(id: string, processedAt: Date): Promise<void> {
    await this.db.whatsappEvent.updateMany({
      where: { id, status: "ENQUEUED" },
      data: { status: "PROCESSED", processedAt },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.db.whatsappEvent.updateMany({
      where: { id, status: { in: ["RECEIVED", "ENQUEUED"] } },
      data: { status: "FAILED" },
    });
  }
}