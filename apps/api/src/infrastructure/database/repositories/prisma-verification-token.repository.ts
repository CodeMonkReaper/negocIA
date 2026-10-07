import { Injectable } from "@nestjs/common";
import type {
  CreateVerificationTokenInput,
  VerificationTokenRecord,
} from "../../../domain/identity/entities";
import type { VerificationTokenRepository } from "../../../domain/ports/verification-token-repository";
import type { Db } from "./prisma-user.repository";

function toVerificationTokenRecord(row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}): VerificationTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaVerificationTokenRepository
  implements VerificationTokenRepository
{
  constructor(private readonly db: Db) {}

  async findByTokenHash(
    tokenHash: string,
  ): Promise<VerificationTokenRecord | null> {
    const row = await this.db.verificationToken.findUnique({
      where: { tokenHash },
    });
    return row ? toVerificationTokenRecord(row) : null;
  }

  async create(
    input: CreateVerificationTokenInput,
  ): Promise<VerificationTokenRecord> {
    const row = await this.db.verificationToken.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
    return toVerificationTokenRecord(row);
  }

  /**
   * Consumo de un solo uso: `usedAt: null` en el `where` hace que un segundo
   * intento con el mismo token devuelva `count === 0` en vez de re-consumirlo.
   */
  async markUsed(id: string, usedAt: Date): Promise<boolean> {
    const result = await this.db.verificationToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt },
    });
    return result.count === 1;
  }

  async invalidatePendingByUser(userId: string, at: Date): Promise<number> {
    const result = await this.db.verificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: at },
    });
    return result.count;
  }
}
