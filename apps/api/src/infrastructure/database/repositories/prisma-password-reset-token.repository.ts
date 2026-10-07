import { Injectable } from "@nestjs/common";
import type {
  CreatePasswordResetTokenInput,
  PasswordResetTokenRecord,
} from "../../../domain/identity/entities";
import type { PasswordResetTokenRepository } from "../../../domain/ports/password-reset-token-repository";
import type { Db } from "./prisma-user.repository";

function toPasswordResetTokenRecord(row: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}): PasswordResetTokenRecord {
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
export class PrismaPasswordResetTokenRepository
  implements PasswordResetTokenRepository
{
  constructor(private readonly db: Db) {}

  async findByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | null> {
    const row = await this.db.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    return row ? toPasswordResetTokenRecord(row) : null;
  }

  async create(
    input: CreatePasswordResetTokenInput,
  ): Promise<PasswordResetTokenRecord> {
    const row = await this.db.passwordResetToken.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
    return toPasswordResetTokenRecord(row);
  }

  /**
   * Consumo de un solo uso: `usedAt: null` en el `where` hace que un segundo
   * intento con el mismo token devuelva `count === 0`.
   */
  async markUsed(id: string, usedAt: Date): Promise<boolean> {
    const result = await this.db.passwordResetToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt },
    });
    return result.count === 1;
  }

  async invalidatePendingByUser(userId: string, at: Date): Promise<number> {
    const result = await this.db.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: at },
    });
    return result.count;
  }
}