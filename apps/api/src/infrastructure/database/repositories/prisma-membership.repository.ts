import { Injectable } from "@nestjs/common";
import type {
  CreateMembershipInput,
  MembershipRecord,
  PrincipalMembership,
} from "../../../domain/identity/entities";
import type { MembershipRepository } from "../../../domain/ports/membership-repository";
import type { Db } from "./prisma-user.repository";
import { translatePrismaError } from "./translate-prisma-error";

function toMembershipRecord(row: {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): MembershipRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type MembershipWithTenantRow = {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  tenant: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
};

export type MembershipWithUser = MembershipRecord & {
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
    emailVerifiedAt: Date | null;
    createdAt: Date;
  };
};

function toPrincipalMembership(
  row: MembershipWithTenantRow,
): PrincipalMembership {
  return {
    ...toMembershipRecord(row),
    tenant: {
      id: row.tenant.id,
      slug: row.tenant.slug,
      name: row.tenant.name,
      plan: row.tenant.plan,
      status: row.tenant.status,
      createdAt: row.tenant.createdAt,
      updatedAt: row.tenant.updatedAt,
    },
  };
}

const WITH_TENANT = { tenant: true } as const;

@Injectable()
export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Db) {}

  async findByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    const row = await this.db.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    return row ? toMembershipRecord(row) : null;
  }

  /**
   * Consulta única que resuelve identidad + autorización en un solo viaje a
   * PostgreSQL (docs/architecture/authentication.md §7).
   *
   * Es el hot path de **todo** request autenticado, así que trae `tenant` en
   * la misma query en lugar de encadenar una segunda consulta por el tenant:
   * el guard necesita el estado del tenant para decidir 403 `tenant_inactive`.
   */
  async findPrincipalMembership(
    tenantId: string,
    userId: string,
  ): Promise<PrincipalMembership | null> {
    const row = await this.db.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: WITH_TENANT,
    });
    return row ? toPrincipalMembership(row as MembershipWithTenantRow) : null;
  }

  async listByUser(userId: string): Promise<PrincipalMembership[]> {
    const rows = await this.db.membership.findMany({
      where: { userId },
      include: WITH_TENANT,
      orderBy: { createdAt: "asc" },
    });
    return (rows as MembershipWithTenantRow[]).map(toPrincipalMembership);
  }

  async listByTenant(tenantId: string): Promise<MembershipWithUser[]> {
    const rows = await this.db.membership.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            status: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      ...toMembershipRecord(row),
      user: row.user,
    }));
  }

  async countActiveByTenant(tenantId: string): Promise<number> {
    return this.db.membership.count({
      where: { tenantId, status: "ACTIVE" },
    });
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    return this.db.membership.count({
      where: { tenantId, role: "OWNER", status: "ACTIVE" },
    });
  }

  async lockActiveOwners(tenantId: string): Promise<void> {
    // `Db` es la unión `PrismaClient | Prisma.TransactionClient` y el tag
    // template de `$queryRaw` no se invoca sobre una unión; el lock solo se
    // pide desde dentro de una transacción (lo garantiza el caso de uso), así
    // que se acota al cliente transaccional.
    const tx = this.db as import("@negocia/database").Prisma.TransactionClient;
    await tx.$queryRaw`
      SELECT "id" FROM "memberships"
      WHERE "tenant_id" = ${tenantId}
        AND "role" = 'OWNER'
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `;
  }

  async create(input: CreateMembershipInput): Promise<MembershipRecord> {
    try {
      const row = await this.db.membership.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
          ...(input.status ? { status: input.status } : {}),
        },
      });
      return toMembershipRecord(row);
    } catch (error) {
      throw translatePrismaError(error, "memberships.create");
    }
  }

  async updateStatus(id: string, status: string): Promise<MembershipRecord> {
    const row = await this.db.membership.update({
      where: { id },
      data: { status },
    });
    return toMembershipRecord(row);
  }

  async updateRole(id: string, role: string): Promise<MembershipRecord> {
    const row = await this.db.membership.update({
      where: { id },
      data: { role },
    });
    return toMembershipRecord(row);
  }
}
