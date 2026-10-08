import { Inject, Injectable } from "@nestjs/common";
import { PRODUCT_REPOSITORY, TENANT_REPOSITORY } from "../../../common/di-tokens";
import type {
  CreateProductData,
  ListProductsFilter,
  ProductRecord,
  UpdateProductData,
} from "../../../domain/catalog/entities";
import { NotFoundError } from "../../../domain/errors";
import { LimitsService } from "../../../domain/plans/limits-service";
import type { ProductRepository } from "../../../domain/ports/product-repository";
import type { TenantRepository } from "../../../domain/ports/tenant-repository";

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly limits: LimitsService,
  ) {}

  async createProduct(
    tenantId: string,
    input: CreateProductData,
  ): Promise<ProductRecord> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError("not_found", "Tenant no encontrado");
    }

    const currentCount = await this.products.count(tenantId);
    this.limits.assertUnderLimit(currentCount, "maxProducts", tenant.plan);

    return this.products.create(tenantId, input);
  }

  async listProducts(
    tenantId: string,
    filter?: ListProductsFilter,
  ): Promise<{ items: ProductRecord[]; total: number }> {
    return this.products.list(tenantId, filter);
  }

  async getProduct(tenantId: string, id: string): Promise<ProductRecord> {
    const product = await this.products.findById(tenantId, id);
    if (!product) {
      throw new NotFoundError("not_found", "Producto o servicio no encontrado");
    }
    return product;
  }

  async updateProduct(
    tenantId: string,
    id: string,
    input: UpdateProductData,
  ): Promise<ProductRecord> {
    const updated = await this.products.update(tenantId, id, input);
    if (!updated) {
      throw new NotFoundError("not_found", "Producto o servicio no encontrado");
    }
    return updated;
  }

  async deleteProduct(tenantId: string, id: string): Promise<void> {
    const deleted = await this.products.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundError("not_found", "Producto o servicio no encontrado");
    }
  }

  async searchProducts(
    tenantId: string,
    query: string,
    limit = 6,
  ): Promise<ProductRecord[]> {
    return this.products.search(tenantId, query, limit);
  }
}

