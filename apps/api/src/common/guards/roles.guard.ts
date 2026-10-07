import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthorizationError } from "../../domain/errors";
import { ROLE_RANK, type Role } from "../../domain/identity/roles";
import { ROLES_KEY } from "./roles.decorator";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Última línea de autorización por rol (docs/architecture/tenant-context.md §6).
 *
 * Solo actúa sobre rutas con `@Roles(...)`; el resto se autoriza por
 * `TenantContextGuard` (membresía activa) y por el caso de uso. Se mantiene
 * separado para que "no tengo membresía" (403) y "no tengo nivel" (403) sean
 * decisiones distintas y auditables.
 *
 * Corre último en la cadena de guards **a propósito**: así el rol ya está
 * resuelto desde BD y no desde el token.
 *
 * Lee el rol de `request.principal` y **no** de `TenantContextService`: los
 * guards se ejecutan antes que los interceptores, y es el
 * `TenantContextInterceptor` quien abre el `AsyncLocalStorage`. Consultar el
 * ALS aquí devolvería siempre `undefined` y rechazaría con 403 toda ruta con
 * `@Roles`, aunque el usuario fuese OWNER. Para el ALS queda el resto de la
 * cadena: servicios, repositorios y transacciones.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allMetadata = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si la ruta es pública, no aplicamos restricciones de rol
    if (allMetadata) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    // Semántica jerárquica: se satisface con el mínimo de los roles pedidos.
    const minimum = required.reduce((lowest, role) =>
      ROLE_RANK[role] < ROLE_RANK[lowest] ? role : lowest,
    );

    const request = context.switchToHttp().getRequest<Request>();
    const current = request.principal?.role ?? null;

    if (current === null || ROLE_RANK[current] < ROLE_RANK[minimum]) {
      throw new AuthorizationError(
        "forbidden",
        "Tu rol no permite esta operación",
        { required: minimum, current },
      );
    }

    return true;
  }
}
