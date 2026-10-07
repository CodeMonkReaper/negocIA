import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import type { Role } from "../../domain/identity/roles";

/**
 * Rol mínimo exigido por la ruta.
 *
 * Semántica **jerárquica** (`hasAtLeast`): `@Roles(Role.OWNER)` también la
 * satisfacen ADMIN y OWNER. El nivel mínimo se toma del argumento más bajo
 * para que `@Roles(Role.ADMIN, Role.OWNER)` signifique "cualquiera de los
 * dos, o superior", y no "ambos".
 *
 * El rol se lee del `TenantContext` (cargado desde BD en cada request), nunca
 * del JWT: los claims son inmutables hasta que expiran y una degradación de
 * rol no puede esperar al siguiente login.
 */
export const ROLES_KEY = "auth:roles";

export const Roles = (...roles: Role[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
