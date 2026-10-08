export interface ProductRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  type: "PRODUCT" | "SERVICE";
  category: string | null;
  durationMinutes: number | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductData {
  name: string;
  description?: string | null;
  price: number;
  currency?: string;
  type?: "PRODUCT" | "SERVICE";
  category?: string | null;
  durationMinutes?: number | null;
}

export interface UpdateProductData {
  name?: string;
  description?: string | null;
  price?: number;
  currency?: string;
  type?: "PRODUCT" | "SERVICE";
  category?: string | null;
  durationMinutes?: number | null;
  status?: "ACTIVE" | "INACTIVE";
}

export interface ListProductsFilter {
  type?: "PRODUCT" | "SERVICE";
  status?: "ACTIVE" | "INACTIVE";
  search?: string;
  limit?: number;
  offset?: number;
}

