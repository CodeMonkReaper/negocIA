import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  AuthorizationError,
  AuthenticationError,
} from "../../domain/errors";
import { resolveRole } from "../../domain/identity/roles";
import type { Principal, TenantContext } from "../../domain/tenant-context";
import {
  MEMBERSHIP_REPOSITORY,
  TENANT_REPOSITORY,
  USER_REPOSITORY,
} from "../di-tokens";
import type { MembershipRepository } from "../../domain/ports/membership-repository";
import type { TenantRepository } from "../../domain/ports/tenant-repository";
import type { UserRepository } from "../../domain/ports/user-repository";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Resuelve el `Principal` desde PostgreSQL y abre el `TenantContext`
 * (docs/architecture/authentication.md §7, docs/architecture/tenant-context.md §4).
 *
 * Es el guard que hace que el JWT no sea unaillon de autoridad. El token solo
 * aporta `sub`, `tenant_id` y `jti`; el rol, el estado de la cuenta, el estado
 * de la membresía y el estado del tenant se releen de la base de datos en
 * **cada** request. Así una degradación de rol o un baja de membresía surten
 * efecto en el request siguiente, no cuando expire el access token.
 *
 * Además deja el contexto en `request.tenantContext`; la apertura efectiva
 * del `AsyncLocalStorage` la hace `TenantContextInterceptor`, porque Nest
 * resuelve los guards **antes** de construir la cadena de interceptores y un
 * guard no recibe la función `next` del handler.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    console.log("[TenantContextGuard] Route is public:", isPublic, {
      handler: context.getHandler()?.name,
      class: context.getClass()?.name,
    });

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const claims = request.authClaims;

    if (!claims) {
      // `JwtAuthGuard` siempre corre antes (orden de `APP_GUARD`); si faltaran
      // claims aquí, el cableado de guards está mal, no el cliente.
      throw new AuthenticationError(
        "invalid_credentials",
        "Petición no autenticada",
      );
    }

    const user = await this.users.findById(claims.sub);
    if (!user) {
      throw new AuthenticationError(
        "invalid_credentials",
        "Token de acceso inválido o expirado",
      );
    }
    if (user.status !== "ACTIVE") {
      throw new AuthorizationError(
        "account_disabled",
        "La cuenta está deshabilitada",
      );
    }

    const [membership, tenant] = await Promise.all([
      this.memberships.findByTenantAndUser(claims.tenant_id, user.id),
      this.tenants.findById(claims.tenant_id),
    ]);

    if (!membership || membership.status !== "ACTIVE") {
      // 403 y no 404: el token es legítimo, lo que falta es autorización. Se
      // usa el mismo código para "no existe" y "no es miembro" para no revelar
      // la existencia de tenants ajenos.
      throw new AuthorizationError(
        "membership_inactive",
        "Membresía inactiva o inexistente en el tenant solicitado",
      );
    }

    if (!tenant || tenant.status !== "ACTIVE") {
      throw new AuthorizationError(
        "tenant_inactive",
        "El tenant no está activo",
      );
    }

    const principal: Principal = {
      userId: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      sessionId: claims.jti,
      tenantId: tenant.id,
      membershipId: membership.id,
      // `resolveRole` degrada a AGENT cualquier valor desconocido: ante un rol
      // corrupto en BD, el menor privilegio es la única respuesta segura.
      role: resolveRole(membership.role),
      membershipStatus: membership.status,
      tenantStatus: tenant.status,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantPlan: tenant.plan,
    };

    const tenantContext: TenantContext = {
      tenantId: tenant.id,
      userId: user.id,
      role: principal.role,
      source: "HTTP_JWT",
      sessionId: claims.jti,
    };

    request.principal = principal;
    request.tenantContext = tenantContext;

    return true;
  }
}
