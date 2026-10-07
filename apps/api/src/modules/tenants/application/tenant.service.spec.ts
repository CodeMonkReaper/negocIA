import { beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../../../domain/errors";
import { makeTenant, InMemoryTenantRepository } from "../../../testing/in-memory/fakes";
import { TenantService } from "./tenant.service";

/**
 * `TenantService` solo edita `name` y `slug`: `plan` y `status` los mueven
 * billing y super-admin. La suite fija qué pasa cuando el patcheador
 * `slugify` normaliza y cuando una intención choca con el estado actual.
 */
describe("TenantService", () => {
  let tenants: InMemoryTenantRepository;
  let service: TenantService;

  const TENANT = "tenant-1";

  beforeEach(() => {
    tenants = new InMemoryTenantRepository();
    tenants.rows.push(
      makeTenant({
        id: TENANT,
        slug: "ana-torres",
        name: "Tetería de Ana",
        plan: "BASIC",
        status: "ACTIVE",
      }),
    );
    service = new TenantService(tenants);
  });

  describe("getCurrent", () => {
    it("devuelve el tenant por id", async () => {
      const tenant = await service.getCurrent(TENANT);
      expect(tenant).toMatchObject({ id: TENANT, slug: "ana-torres" });
    });

    it("tenant inexistente → not_found", async () => {
      await expect(service.getCurrent("tenant-fantasma")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe("updateCurrent", () => {
    it("edita el nombre", async () => {
      const updated = await service.updateCurrent({
        tenantId: TENANT,
        name: "Café de Ana y Pedro",
      });

      expect(updated.name).toBe("Café de Ana y Pedro");
      expect(updated.plan).toBe("BASIC"); // nunca se toca desde aquí
      expect(updated.status).toBe("ACTIVE");
    });

    it("normaliza el slug con `slugify` (minúsculas, sin acentos)", async () => {
      const updated = await service.updateCurrent({
        tenantId: TENANT,
        slug: "Café de Ana!",
      });

      expect(updated.slug).toBe("cafe-de-ana");
    });

    it("slug igual al normalizado actual → no-op sin consultar unicidad", async () => {
      const updated = await service.updateCurrent({
        tenantId: TENANT,
        slug: "Ana Torres",
      });

      // `slugify("Ana Torres")` = "ana-torres" = el actual.
      expect(updated.slug).toBe("ana-torres");
    });

    it("slug ocupado por otro tenant → 409", async () => {
      tenants.rows.push(
        makeTenant({
          id: "tenant-2",
          slug: "cafe-verde",
          name: "Café Verde",
        }),
      );

      const attempt = service.updateCurrent({
        tenantId: TENANT,
        slug: "Café Verde",
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    });

    it("tenant inexistente → not_found", async () => {
      await expect(
        service.updateCurrent({ tenantId: "tenant-fantasma", name: "x" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("cuerpo vacío → no hay patch y se devuelve el tenant sin cambios", async () => {
      const updated = await service.updateCurrent({ tenantId: TENANT });
      expect(updated.name).toBe("Tetería de Ana");
      expect(updated.slug).toBe("ana-torres");
    });
  });
});