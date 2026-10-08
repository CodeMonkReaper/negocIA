import type {
  CreateProductData,
  ListProductsFilter,
  ProductRecord,
  UpdateProductData,
} from "../catalog/entities";

export interface ProductRepository {
  create(tenantId: string, data: CreateProductData): Promise<ProductRecord>;
  update(
    tenantId: string,
    id: string,
    data: UpdateProductData,
  ): Promise<ProductRecord | null>;
  findById(tenantId: string, id: string): Promise<ProductRecord | null>;
  list(
    tenantId: string,
    filter?: ListProductsFilter,
  ): Promise<{ items: ProductRecord[]; total: number }>;
  search(tenantId: string, query: string, limit?: number): Promise<ProductRecord[]>;
  count(tenantId: string, status?: "ACTIVE" | "INACTIVE"): Promise<number>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

