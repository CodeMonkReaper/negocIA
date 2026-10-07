import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { InternalServerError } from "../../domain/errors";
import type {
  Principal,
  TenantContext,
  TenantContextSource,
} from "../../domain/tenant-context";
import type { Role } from "../../domain/identity/roles";
import { hasAtLeast } from "../../domain/identity/roles";

/**
 * Propagación del `TenantContext` por `AsyncLocalStorage`
 * (docs/architecture/tenant-context.md §3).
 *
 * Se prefiere a REQUEST-scope de Nest por dos razones: no obliga a que los
 * providers sean request-scoped (lo que propaga el scope a toda la cadena y
 * complica los providers singleton) y no obliga a pasar el contexto por firma
 * en cada llamada.
 *
 * El contexto se fija **en la entrada** (guard, o el helper de worker/webhook
 * en Fase 2) y queda disponible para toda la cadena asíncrona: servicio →
 * repositorio → transacción Prisma.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(context: TenantContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /** Contexto activo, o `undefined` si la operación no está autenticada. */
  getContext(): TenantContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Contexto obligatorio para operaciones tenant-scoped.
   *
   * docs/architecture/tenant-context.md §8.1: si falta el contexto, el
   * comportamiento correcto es fallar, **nunca** ejecutar una query global
   * ("sin tenant, todo tenant"). El 500 es deliberado: signifies un bug de
   * cableado (un caso de uso called sin guard), no un error del cliente.
   */
  requireContext(): TenantContext {
    const context = this.storage.getStore();
    if (!context) {
      throw new InternalServerError(
        "No hay TenantContext activo en esta operación",
      );
    }
    return context;
  }

  requireTenantId(): string {
    return this.requireContext().tenantId;
  }

  /**
   * Rol activo, resuelto desde BD por el guard (nunca del JWT).
   *
   * `@Roles()` de `RolesGuard` usa `hasAtLeast` sobre este valor.
   */
  requireRole(): Role {
    const role = this.requireContext().role;
    if (!role) {
      throw new InternalServerError(
        "El TenantContext activo no tiene rol asociado",
      );
    }
    return role;
  }

  /**
   * `true` si el rol activo cumple el mínimo exigido.
   *
   * Devuelve un booleano en lugar de lanzar: quien decide el 403 es
   * `RolesGuard`, que además necesita responder 403 `forbidden` y no un 500.
   */
  satisfiesRole(minimum: Role): boolean {
    const role = this.getContext()?.role;
    return role ? hasAtLeast(role, minimum) : false;
  }
}

export type { Principal, TenantContext, TenantContextSource };
