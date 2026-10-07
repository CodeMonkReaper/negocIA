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
  tokenExpiresAt: Date | null;
  tokenRefreshedAt: Date | null;
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
    tokenExpiresAt: row.tokenExpiresAt,
    tokenRefreshedAt: row.tokenRefreshedAt,
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

  async findExpiringBefore(date: Date): Promise<WhatsappAccountRecord[]> {
    const rows = await this.db.whatsappAccount.findMany({
      where: {
        status: { in: ["ACTIVE", "TOKEN_EXPIRED"] },
        AND: [
          {
            OR: [
              { tokenExpiresAt: { lte: date } },
              // Cuentas sin vencimiento registrado: mejor re-firmar que dejar
              // que el token caiga en silencio, así se fechan en el intento.
              { tokenExpiresAt: null },
            ],
          },
        ],
      },
      orderBy: [{ tokenExpiresAt: { sort: "asc", nulls: "first" } }],
    });
    return rows.map((row) => toAccountRecord(row, this.crypto));
  }

  async create(
    input: CreateWhatsappAccountInput,
  ): Promise<WhatsappAccountRecord> {
    try {
      const encrypted = this.crypto.encrypt(input.accessToken);
      const tokenExpiresAt = input.tokenExpiresAt ?? null;
      const row = await this.db.whatsappAccount.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          tenantId: input.tenantId,
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhone: input.displayPhone ?? null,
          accessTokenEncrypted: encrypted as unknown as Prisma.InputJsonValue,
          tokenExpiresAt,
          tokenRefreshedAt: tokenExpiresAt ? new Date() : null,
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
      const withExpiry =
        input.tokenExpiresAt !== undefined && input.tokenExpiresAt !== null;
      const row = await this.db.whatsappAccount.update({
        where: { id: input.id },
        data: {
          accessTokenEncrypted: encrypted as unknown as Prisma.InputJsonValue,
          // Un token re-firmado o renovado devuelve la cuenta a ACTIVE (pudo
          // estar TOKEN_EXPIRED por un 190 detectado en un envío).
          status: "ACTIVE",
          ...(withExpiry
            ? {
                tokenExpiresAt: input.tokenExpiresAt,
                tokenRefreshedAt: new Date(),
              }
            : {}),
          updatedAt: new Date(),
        },
      });
      return toAccountRecord(row, this.crypto);
    } catch (error) {
      throw translatePrismaError(error, "whatsapp_accounts");
    }
  }

  async markTokenExpired(id: string): Promise<void> {
    try {
      await this.db.whatsappAccount.update({
        where: { id },
        data: { status: "TOKEN_EXPIRED", updatedAt: new Date() },
      });
    } catch (error) {
      throw translatePrismaError(error, "whatsapp_accounts");
    }
  }
}