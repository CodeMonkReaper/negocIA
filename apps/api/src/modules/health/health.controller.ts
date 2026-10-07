import {
  Controller,
  Get,
  Res,
  VERSION_NEUTRAL,
  Version,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { HealthResponse, ReadinessResponse } from "@negocia/contracts";
import type { Response } from "express";
import { CorrelationService } from "../../common/correlation/correlation.service";
import { Public } from "../../common/guards/public.decorator";
import { HealthService } from "./health.service";

// Público: un probe de readiness no puede exigir un token, o el orquestador
// tendría que autenticar cada liveness check. Es una de las dos excepciones
// al fail-closed de `JwtAuthGuard`.
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly correlationService: CorrelationService,
  ) {}

  // `VERSION_NEUTRAL` mantiene la ruta en `/api/health` pese al URI versioning
  // global: la URL ya está publicada en el `.env` del front
  // (`NEXT_PUBLIC_API_URL=/api` + `/health`), en el README y en la docs de
  // despliegue. Sin esto, `defaultVersion: "1"` la movería a
  // `/api/v1/health` y el status panel del front mostraría "error" sin que
  // nadie hubiera tocado el front. Va en el método, no en la clase: `@Version`
  // es un decorator de handler.
  @Get()
  @Version(VERSION_NEUTRAL)
  check(): HealthResponse {
    return this.healthService.check(this.correlationService.getId());
  }

  /**
   * Readiness. Devuelve 503 cuando PostgreSQL no responde, para que el
   * balanceador retire la instancia sin reiniciarla: el reinicio no arregla
   * una base de datos caída, y hacerlo en bucle agota el presupuesto de
   * reinicios mientras la app sigue sin poder trabajar.
   */
  @Get("ready")
  @Version(VERSION_NEUTRAL)
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponse> {
    const response = await this.healthService.ready(this.correlationService.getId());

    // El 503 se escribe en la respuesta, no se lanza. Lanzar `AppError` la
    // pasaría por `AllExceptionsFilter`, que envolvería el diagnóstico en un
    // `ApiError` y perdería `dependencies`, que es justo el campo que el
    // orquestador necesita leer.
    res.status(response.status === "down" ? 503 : 200);
    return response;
  }
}