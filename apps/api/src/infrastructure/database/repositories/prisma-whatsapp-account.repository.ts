import { Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@negocia/database";
import { CryptoService } from "@negocia/config";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";
import type {
  CreateWhatsappAccountInput,
  UpdateWhatsappAccountInput,
  WhatsappAccountRepository,
} from "../../../domain/ports/whatsapp-account-repository";
import { translatePrismaError } from "./translate-prisma-error";

export type Db = PrismaClient | Prisma.TransactionClient;

interface EncryptedPayloadRow {
  iv: string;
  ciphertext: string;
  tag: string;
}

function toAccountRecord(row: {
  id: string;
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string | null;
  accessTokenEncrypted: Prisma.JsonValue;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}, crypto: CryptoService): WhatsappAccountRecord {
  const encrypted = row.accessTokenEncrypted as unknown as EncryptedPayloadRow;
  const accessToken = crypto.decrypt(encrypted);
  return {
    id: row.id,
    tenantId: row.tenantId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhone: row.displayPhone,
    accessToken,
    accessTokenEncrypted: encrypted,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaWhatsappAccountRepository implements WhatsappAccountRepository {
  constructor(
    private readonly db: Db,
    private readonly crypto: CryptoService,
  ) {}

  async findByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<WhatsappAccountRecord | null> {
    const row = await this.db.whatsappAccount.findFirst({
      where: { phoneNumberId, status: "ACTIVE" },
    });
    return row ? toAccountRecord(row, this.crypto) : null;
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<WhatsappAccountRecord | null> {
    const row = await this.db.whatsappAccount.findFirst({
      where: { id, tenantId, status: "ACTIVE" },
    });
    return row ? toAccountRecord(row, this.crypto) : null;
  }

  async listByTenant(tenantId: string): Promise<WhatsappAccountRecord[]> {
    const rows = await this.db.whatsappAccount.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => toAccountRecord(row, this.crypto));
  }

  async create(
    input: CreateWhatsappAccountInput,
  ): Promise<WhatsappAccountRecord> {
    try {
      const encrypted = this.crypto.encrypt(input.accessToken);
      const row = await this.db.whatsappAccount.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          tenantId: input.tenantId,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhone: input.displayPhone ?? null,
          accessTokenEncrypted: encrypted as unknown as Prisma.InputJsonValue,
        },
      });
      return toAccountRecord(row, this.crypto);
    } catch (error) {
      throw translatePrismaError(error, "whatsapp_accounts");
    }
  }

  async updateAccessToken(
    input: UpdateWhatsappAccountInput,
  ): Promise<WhatsappAccountRecord> {
    try {
      const encrypted = this.crypto.encrypt(input.accessToken);
      const row = await this.db.whatsappAccount.update({
        where: { id: input.id },
        data: {
          accessTokenEncrypted: encrypted as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
      return toAccountRecord(row, this.crypto);
    } catch (error) {
      throw translatePrismaError(error, "whatsapp_accounts");
    }
  }
}