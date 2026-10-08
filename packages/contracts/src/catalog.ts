/**
 * Contratos de wire del catálogo de productos y servicios (F3-3b).
 */

export const PRODUCT_TYPES = ["PRODUCT", "SERVICE"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface ProductResponseDto {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  type: ProductType;
  category: string | null;
  durationMinutes: number | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInputDto {
  name: string;
  description?: string | null;
  price: number;
  currency?: string;
  type?: ProductType;
  category?: string | null;
  durationMinutes?: number | null;
}

export interface UpdateProductInputDto {
  name?: string;
  description?: string | null;
  price?: number;
  currency?: string;
  type?: ProductType;
  category?: string | null;
  durationMinutes?: number | null;
  status?: ProductStatus;
}

