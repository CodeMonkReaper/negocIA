import { Module } from "@nestjs/common";
import { TenantService } from "./application/tenant.service";
import { TenantUsersService } from "./application/tenant-users.service";
import { TenantsController } from "./presentation/tenants.controller";

/**
 * Metadatos y usuarios del tenant activo (docs/api/authentication.md §9–§10).
 *
 * Es un módulo sin imports: consume puertos de `DatabaseModule` (global),
 * resolverá el rol desde el `Principal` que ya cargó `TenantContextGuard`, y la
 * autorización fina (ADMIN contra OWNER, último OWNER) es del servicio, no del
 * guard.
 */
@Module({
  controllers: [TenantsController],
  providers: [TenantService, TenantUsersService],
})
export class TenantsModule {}