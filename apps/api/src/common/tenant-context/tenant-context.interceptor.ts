import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import type { Request } from "express";
import { TenantContextService } from "../tenant-context/tenant-context.service";

/**
 * Abre el `AsyncLocalStorage` del `TenantContext` durante la ejecución del
 * handler (docs/architecture/tenant-context.md §3).
 *
 * Por qué un interceptor y no el propio guard:
 *
 *  - El orden de resolución de Nest es middleware → **guards** →
 *    **interceptors** → pipes → handler. Un guard se resuelve por completo
 *    antes de que exista la cadena de interceptores, y `CanActivate` no recibe
 *    la función `next` del handler: el `run(...)` de un guard solo abarcaría su
 *    propio retorno, no el servicio.
 *  - `next.handle()` sí ejecuta el handler dentro del contexto creado por
 *    `AsyncLocalStorage.run`, y con él todas las promesas que el handler cree
 *    (servicio → repositorio → transacción Prisma).
 *
 * Por eso el trabajo se reparte: el **guard** decide *qué* contexto es (con
 * datos de BD) y el **interceptor** decide *cuándo* vive.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly contextService: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const tenantContext = request.tenantContext;

    // Rutas públicas (`/health`, login, register, refresh): no hay principal,
    // así que no hay contexto que propagar. Un caso de uso tenant-scoped
    // invocado desde ahí fallaría en `requireContext()` en lugar de operar
    // sin filtro de tenant.
    if (!tenantContext) {
      return next.handle();
    }

    return this.contextService.run(tenantContext, () => next.handle());
  }
}
