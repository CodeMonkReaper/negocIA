import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@negocia/database";
import type {
  CreateProductData,
  ListProductsFilter,
  ProductRecord,
  UpdateProductData,
} from "../../../domain/catalog/entities";
import type { ProductRepository } from "../../../domain/ports/product-repository";

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, data: CreateProductData): Promise<ProductRecord> {
    const row = await this.prisma.product.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        currency: data.currency ?? "CLP",
        type: data.type ?? "PRODUCT",
        category: data.category ?? null,
        durationMinutes: data.durationMinutes ?? null,
        status: "ACTIVE",
      },
    });
    return this.toRecord(row);
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateProductData,
  ): Promise<ProductRecord | null> {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return null;
    }

    const row = await this.prisma.product.update({
      where: { id },
      data: {
        name: data.name !== undefined ? data.name : undefined,
        description: data.description !== undefined ? data.description : undefined,
        price: data.price !== undefined ? data.price : undefined,
        currency: data.currency !== undefined ? data.currency : undefined,
        type: data.type !== undefined ? data.type : undefined,
        category: data.category !== undefined ? data.category : undefined,
        durationMinutes:
          data.durationMinutes !== undefined ? data.durationMinutes : undefined,
        status: data.status !== undefined ? data.status : undefined,
      },
    });
    return this.toRecord(row);
  }

  async findById(tenantId: string, id: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    return row ? this.toRecord(row) : null;
  }

  async list(
    tenantId: string,
    filter: ListProductsFilter = {},
  ): Promise<{ items: ProductRecord[]; total: number }> {
    const where: Record<string, unknown> = { tenantId };
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.type) {
      where.type = filter.type;
    }
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: "insensitive" } },
        { description: { contains: filter.search, mode: "insensitive" } },
        { category: { contains: filter.search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        take: filter.limit ?? 50,
        skip: filter.offset ?? 0,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
    };
  }

  async search(tenantId: string, query: string, limit = 6): Promise<ProductRecord[]> {
    const trimmed = query.trim();
    const where: Record<string, unknown> = {
      tenantId,
      status: "ACTIVE",
    };
    if (trimmed) {
      where.OR = [
        { name: { contains: trimmed, mode: "insensitive" } },
        { description: { contains: trimmed, mode: "insensitive" } },
        { category: { contains: trimmed, mode: "insensitive" } },
      ];
    }

    const rows = await this.prisma.product.findMany({
      where,
      take: limit,
      orderBy: { name: "asc" },
    });

    return rows.map((r) => this.toRecord(r));
  }

  async count(tenantId: string, status?: "ACTIVE" | "INACTIVE"): Promise<number> {
    return this.prisma.product.count({
      where: {
        tenantId,
        status: status ? status : undefined,
      },
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      return false;
    }
    await this.prisma.product.delete({ where: { id } });
    return true;
  }

  private toRecord(row: {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    price: unknown;
    currency: string;
    type: string;
    category: string | null;
    durationMinutes: number | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): ProductRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      price: Number(row.price),
      currency: row.currency,
      type: row.type as "PRODUCT" | "SERVICE",
      category: row.category,
      durationMinutes: row.durationMinutes,
      status: row.status as "ACTIVE" | "INACTIVE",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

