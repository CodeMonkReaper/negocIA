import { Injectable } from "@nestjs/common";
import type {
  CreateRefreshTokenInput,
  RefreshTokenRecord,
} from "../../../domain/identity/entities";
import type { RefreshTokenRepository } from "../../../domain/ports/refresh-token-repository";
import type { Db } from "./prisma-user.repository";

function toRefreshTokenRecord(row: {
  id: string;
  userId: string;
  sessionId: string;
  tenantId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById: row.replacedById,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async findByTokenHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | null> {
    const row = await this.db.refreshToken.findUnique({ where: { tokenHash } });
    return row ? toRefreshTokenRecord(row) : null;
  }

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const row = await this.db.refreshToken.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        userId: input.userId,
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ...(input.ip ? { ip: input.ip } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      },
    });
    return toRefreshTokenRecord(row);
  }

  /**
   * Revocación condicional: el `where` incluye `revokedAt: null` y se usa
   * `updateMany` (no `update`), de modo que el propio UPDATE decide el
   * ganador en la carrera.
   *
   * Con `findFirst` + `update` dos refresh simultáneos leerían ambos
   * `revokedAt = null` y los dos "revocarían" con éxito, emitiendo dos access
   * tokens para la misma rotación.
   */
  async revokeIfActive(
    id: string,
    revokedAt: Date,
    replacedById?: string,
  ): Promise<boolean> {
    const result = await this.db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: {
        revokedAt,
        ...(replacedById ? { replacedById } : {}),
      },
    });
    return result.count === 1;
  }

  async revokeFamily(sessionId: string, revokedAt: Date): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count;
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count;
  }

  async listActiveByUser(userId: string): Promise<RefreshTokenRecord[]> {
    const rows = await this.db.refreshToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toRefreshTokenRecord);
  }

  async countActiveByUser(userId: string): Promise<number> {
    return this.db.refreshToken.count({ where: { userId, revokedAt: null } });
  }
}
