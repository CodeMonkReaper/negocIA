import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../../domain/errors";
import { LimitsService } from "../../../domain/plans/limits-service";
import type { ProductRepository } from "../../../domain/ports/product-repository";
import type { TenantRepository } from "../../../domain/ports/tenant-repository";
import { CatalogService } from "./catalog.service";

describe("CatalogService", () => {
  const dummyProduct = {
    id: "prod-1",
    tenantId: "tenant-1",
    name: "Corte de pelo",
    description: "Corte clásico",
    price: 12000,
    currency: "CLP",
    type: "SERVICE" as const,
    category: "Peluquería",
    durationMinutes: 45,
    status: "ACTIVE" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function buildService(options: {
    tenant?: { id: string; plan: string } | null;
    productCount?: number;
    product?: typeof dummyProduct | null;
  } = {}) {
    const products: ProductRepository = {
      create: vi.fn().mockResolvedValue(dummyProduct),
      update: vi.fn().mockResolvedValue(options.product ?? dummyProduct),
      findById: vi.fn().mockResolvedValue(options.product !== undefined ? options.product : dummyProduct),
      list: vi.fn().mockResolvedValue({ items: [dummyProduct], total: 1 }),
      search: vi.fn().mockResolvedValue([dummyProduct]),
      count: vi.fn().mockResolvedValue(options.productCount ?? 0),
      delete: vi.fn().mockResolvedValue(options.product !== null),
    };

    const tenants: TenantRepository = {
      findById: vi.fn().mockResolvedValue(
        options.tenant !== undefined ? options.tenant : { id: "tenant-1", plan: "BASIC" },
      ),
      findBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    const limits = new LimitsService();
    const service = new CatalogService(products, tenants, limits);

    return { service, products, tenants };
  }

  describe("createProduct", () => {
    it("crea el producto cuando está dentro del límite del plan", async () => {
      const { service, products } = buildService({ productCount: 5 });

      const result = await service.createProduct("tenant-1", {
        name: "Corte de pelo",
        price: 12000,
      });

      expect(result).toEqual(dummyProduct);
      expect(products.create).toHaveBeenCalledWith("tenant-1", {
        name: "Corte de pelo",
        price: 12000,
      });
    });

    it("lanza NotFoundError si el tenant no existe", async () => {
      const { service } = buildService({ tenant: null });

      await expect(
        service.createProduct("tenant-1", { name: "Corte", price: 1000 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lanza ConflictError si se supera el límite de productos del plan", async () => {
      // BASIC tiene maxProducts: 10
      const { service } = buildService({ productCount: 10 });

      await expect(
        service.createProduct("tenant-1", { name: "Corte", price: 1000 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("getProduct", () => {
    it("devuelve el producto si existe", async () => {
      const { service } = buildService();
      const product = await service.getProduct("tenant-1", "prod-1");
      expect(product).toEqual(dummyProduct);
    });

    it("lanza NotFoundError si el producto no existe", async () => {
      const { service } = buildService({ product: null });
      await expect(
        service.getProduct("tenant-1", "prod-1"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("updateProduct", () => {
    it("actualiza el producto si existe", async () => {
      const { service, products } = buildService();
      const updated = await service.updateProduct("tenant-1", "prod-1", { price: 15000 });
      expect(updated).toEqual(dummyProduct);
      expect(products.update).toHaveBeenCalledWith("tenant-1", "prod-1", { price: 15000 });
    });

    it("lanza NotFoundError si el producto a actualizar no existe", async () => {
      const { service, products } = buildService();
      vi.mocked(products.update).mockResolvedValue(null);
      await expect(
        service.updateProduct("tenant-1", "prod-1", { price: 15000 }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("deleteProduct", () => {
    it("elimina el producto si existe", async () => {
      const { service, products } = buildService();
      await service.deleteProduct("tenant-1", "prod-1");
      expect(products.delete).toHaveBeenCalledWith("tenant-1", "prod-1");
    });

    it("lanza NotFoundError si el producto no existe para eliminar", async () => {
      const { service, products } = buildService();
      vi.mocked(products.delete).mockResolvedValue(false);
      await expect(
        service.deleteProduct("tenant-1", "prod-1"),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("searchProducts", () => {
    it("delega la búsqueda al repositorio con tenant y query", async () => {
      const { service, products } = buildService();
      const results = await service.searchProducts("tenant-1", "corte", 5);
      expect(results).toEqual([dummyProduct]);
      expect(products.search).toHaveBeenCalledWith("tenant-1", "corte", 5);
    });
  });
});

