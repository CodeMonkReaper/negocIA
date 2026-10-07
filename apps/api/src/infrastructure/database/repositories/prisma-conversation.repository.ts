import { Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@negocia/database";
import type {
  ConversationRecord,
  DeliveryStatusUpdate,
  InboundMessageDraft,
  MessageRecord,
  OutboundMessageDraft,
} from "../../../domain/conversations/entities";
import type {
  ConversationPage,
  ConversationRepository,
  ListConversationsOptions,
  ListMessagesOptions,
} from "../../../domain/ports/conversation-repository";

function toConversationRecord(row: {
  id: string;
  tenantId: string;
  accountId: string;
  customerWaId: string;
  customerName: string | null;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    customerWaId: row.customerWaId,
    customerName: row.customerName,
    status: row.status as ConversationRecord["status"],
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessageRecord(row: {
  id: string;
  tenantId: string;
  conversationId: string;
  providerMessageId: string;
  direction: string;
  type: string;
  content: string | null;
  deliveryStatus: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): MessageRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    providerMessageId: row.providerMessageId,
    direction: row.direction as MessageRecord["direction"],
    type: row.type,
    content: row.content,
    deliveryStatus: row.deliveryStatus as MessageRecord["deliveryStatus"],
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Adaptador Prisma de `conversations` y `messages` (F2-4).
 *
 * Idempotencia en escritura: `recordInboundMessage` corre dentro de
 * `$transaction` y `messages.provider_message_id` es UNIQUE global. Si un
 * reenvío de Meta (o dos copias del mismo job en paralelo) intenta insertar la
 * misma pieza, el P2002 deshace la transacción completa —incluida la
 * conversación recién creada— y devuelve `"duplicated"`.
 */
@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(
    tenantId: string,
    id: string,
  ): Promise<ConversationRecord | null> {
    const row = await this.db.conversation.findFirst({
      where: { id, tenantId },
    });
    return row ? toConversationRecord(row) : null;
  }

  async listByTenant(
    tenantId: string,
    options: ListConversationsOptions,
  ): Promise<ConversationPage<ConversationRecord>> {
    const where = {
      tenantId,
      ...(options.status ? { status: options.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        skip: options.offset,
        take: options.limit,
      }),
      this.db.conversation.count({ where }),
    ]);
    return { items: rows.map(toConversationRecord), total };
  }

  async recordInboundMessage(
    scope: { tenantId: string; accountId: string },
    draft: InboundMessageDraft,
  ): Promise<
    { conversation: ConversationRecord; message: MessageRecord } | "duplicated"
  > {
    const receivedAt = new Date();
    try {
      return await this.db.$transaction(async (tx) => {
        const conversation = await tx.conversation.upsert({
          where: {
            tenantId_accountId_customerWaId: {
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              customerWaId: draft.customerWaId,
            },
          },
          create: {
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            customerWaId: draft.customerWaId,
            customerName: draft.customerName,
            lastMessageAt: receivedAt,
          },
          update: {},
        });

        const message = await tx.message.create({
          data: {
            tenantId: scope.tenantId,
            conversationId: conversation.id,
            providerMessageId: draft.providerMessageId,
            direction: "INBOUND",
            type: draft.type,
            content: draft.content,
            metadata: draft.metadata as Prisma.InputJsonValue,
            createdAt: receivedAt,
          },
        });

        if (conversation.lastMessageAt?.getTime() !== receivedAt.getTime()) {
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: receivedAt },
          });
        }

        return {
          conversation: toConversationRecord(conversation),
          message: toMessageRecord(message),
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return "duplicated";
      }
      throw error;
    }
  }

  async recordDeliveryStatus(
    tenantId: string,
    update: DeliveryStatusUpdate,
  ): Promise<boolean> {
    const result = await this.db.message.updateMany({
      where: { tenantId, providerMessageId: update.providerMessageId },
      data: { deliveryStatus: update.deliveryStatus },
    });
    return result.count > 0;
  }

  async recordOutboundMessage(
    scope: { tenantId: string; conversationId: string },
    draft: OutboundMessageDraft,
  ): Promise<MessageRecord> {
    const sentAt = new Date();
    try {
      return await this.db.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            tenantId: scope.tenantId,
            conversationId: scope.conversationId,
            providerMessageId: draft.providerMessageId,
            direction: "OUTBOUND",
            type: draft.type ?? "text",
            content: draft.content,
            metadata: {},
            createdAt: sentAt,
          },
        });

        await tx.conversation.update({
          where: { id: scope.conversationId },
          data: { lastMessageAt: sentAt },
        });

        return toMessageRecord(message);
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        const existing = await this.db.message.findUnique({
          where: { providerMessageId: draft.providerMessageId },
        });
        if (existing) {
          return toMessageRecord(existing);
        }
      }
      throw error;
    }
  }

  async listMessages(
    tenantId: string,
    conversationId: string,
    options: ListMessagesOptions,
  ): Promise<ConversationPage<MessageRecord>> {
    const where = { tenantId, conversationId };
    const [rows, total] = await Promise.all([
      this.db.message.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: options.offset,
        take: options.limit,
      }),
      this.db.message.count({ where }),
    ]);
    return { items: rows.map(toMessageRecord), total };
}

  async updateStatus(tenantId: string, conversationId: string, from: string, to: string): Promise<ConversationRecord | null> {
    try {
      const row = await this.db.conversation.update({
        where: { id: conversationId, tenantId, status: from },
        data: { status: to },
      });
      return toConversationRecord(row);
    } catch (error) {
      const e = error as { code?: string };
      if (e.code === "P2025") {
        return null;
      }
      throw error;
    }
  }

  async getConversation(tenantId:string,conversationId:string):Promise<ConversationRecord>{const row=await this.db.conversation.findUnique({where:{id:conversationId,tenantId}});if(!row) throw new Error("Conversation not found");return toConversationRecord(row);}

  async listRecentMessages(tenantId: string, conversationId: string, take: number): Promise<MessageRecord[]> {
    const rows = await this.db.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: "desc" },
      take,
    });
    return rows.reverse().map(toMessageRecord);
  }
}
