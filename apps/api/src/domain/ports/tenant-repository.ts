import type {
  CreateTenantInput,
  TenantRecord,
} from "../identity/entities";

/** Puerto de acceso a `tenants` (tabla global, no tenant-scoped). */
export interface TenantRepository {
  findById(id: string): Promise<TenantRecord | null>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
  /** `exists` de slug: usado por la resolución de colisiones al registrar. */
  slugExists(slug: string): Promise<boolean>;
  create(input: CreateTenantInput): Promise<TenantRecord>;
  update(id: string, patch: Partial<Pick<TenantRecord, "name" | "slug">>): Promise<TenantRecord>;
}
