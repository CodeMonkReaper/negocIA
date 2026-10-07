import { Injectable } from "@nestjs/common";
import type { TenantRecord } from "../../../domain/identity/entities";
import type { TenantRepository } from "../../../domain/ports/tenant-repository";
import type { Db } from "./prisma-user.repository";
import { translatePrismaError } from "./translate-prisma-error";

function toTenantRecord(row: {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): TenantRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plan: row.plan,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.db.tenant.findUnique({ where: { id } });
    return row ? toTenantRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    const row = await this.db.tenant.findUnique({ where: { slug } });
    return row ? toTenantRecord(row) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    // count en lugar de findUnique: no necesitamos la fila completa y así el
    // resultado es inequívoco (findUnique devuelve null, no false).
    const count = await this.db.tenant.count({ where: { slug } });
    return count > 0;
  }

  async create(input: {
    id?: string;
    slug: string;
    name: string;
    plan?: string;
  }): Promise<TenantRecord> {
    try {
      const row = await this.db.tenant.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          slug: input.slug,
          name: input.name,
          ...(input.plan ? { plan: input.plan } : {}),
        },
      });
      return toTenantRecord(row);
    } catch (error) {
      throw translatePrismaError(error, "tenants.create");
    }
  }

  async update(
    id: string,
    patch: Partial<Pick<TenantRecord, "name" | "slug">>,
  ): Promise<TenantRecord> {
    const row = await this.db.tenant.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
      },
    });
    return toTenantRecord(row);
  }
}
