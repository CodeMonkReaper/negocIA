import { Global, Module } from "@nestjs/common";
import { TenantContextInterceptor } from "./tenant-context.interceptor";
import { TenantContextService } from "./tenant-context.service";

/**
 * Global porque el contexto lo consumen los guards (registrados como
 * `APP_GUARD` en el módulo raíz), el interceptor global y, en Fase 2+, handlers
 * de worker y ejecutores de Tools, todos fuera del módulo que lo declara.
 */
@Global()
@Module({
  providers: [TenantContextService, TenantContextInterceptor],
  exports: [TenantContextService, TenantContextInterceptor],
})
export class TenantContextModule {}
