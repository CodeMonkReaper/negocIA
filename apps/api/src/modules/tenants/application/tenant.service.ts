import { Inject, Injectable } from "@nestjs/common";
import { ConflictError, NotFoundError } from "../../../domain/errors";
import type { TenantRecord } from "../../../domain/identity/entities";
import { slugify } from "../../../domain/identity";
import type { TenantRepository } from "../../../domain/ports";
import { TENANT_REPOSITORY } from "../../../common/di-tokens";

export interface UpdateTenantCommand {
  tenantId: string;
  name?: string;
  slug?: string;
}

/**
 * Metadatos del tenant activo (docs/api/authentication.md §10).
 *
 * Solo `name` y `slug` son editables por el OWNER. `plan` y `status` los mueven
 * billing y super-admin, no el inquilino, así que el port `update` —que acepta
 * ambos— se llama aquí con la selección cerrada.
 */
@Injectable()
export class TenantService {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  async getCurrent(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError("not_found", "Tenant no encontrado");
    }
    return tenant;
  }

  async updateCurrent(command: UpdateTenantCommand): Promise<TenantRecord> {
    const tenant = await this.tenants.findById(command.tenantId);
    if (!tenant) {
      throw new NotFoundError("not_found", "Tenant no encontrado");
    }

    const patch = await this.resolvePatch(command, tenant);

    return this.tenants.update(command.tenantId, patch);
  }

  private async resolvePatch(
    command: UpdateTenantCommand,
    current: TenantRecord,
  ): Promise<{ name?: string; slug?: string }> {
    const patch: { name?: string; slug?: string } = {};

    if (command.name !== undefined && command.name !== current.name) {
      patch.name = command.name;
    }

    if (command.slug !== undefined) {
      const target = slugify(command.slug);
      if (target === current.slug) {
        // El slug normalizado coincide con el actual: no hay nada que hacer.
        return patch;
      }
      if (await this.tenants.slugExists(target)) {
        // A diferencia del registro —donde la colisión se auto-sufija—, editar
        // el slug es intencional: el propietario pide una URL concreta, y si
        // ya existe se le dice, no se la cambia a otra por su cuenta.
        throw new ConflictError(
          "conflict",
          "El slug del tenant ya está en uso",
          { slug: target },
        );
      }
      patch.slug = target;
    }

    return patch;
  }
}