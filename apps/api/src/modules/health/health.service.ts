import { Inject, Injectable } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@negocia/contracts";
import { DEPENDENCY_PROBES } from "../../common/di-tokens";
import type { DependencyProbe, DependencyStatus } from "../../domain/ports/dependency-probe";

const SERVICE_NAME = "negocia-api";

/**
 * Liveness y readiness deliberadamente separados.
 *
 * - `check()` (**liveness**) no toca dependencias. Responde "el proceso está
 *   vivo", que es lo único que el proceso puede arreglar reiniciándose. Meter
 *   aquí la BD produce el fallo clásico: PostgreSQL cae, el orquestador reinicia
 *   la API, la API no puede hablar con la BD porque sigue caída, y el
 *   reinicio no cura nada pero consume el presupuesto de reinicios.
 * - `ready()` (**readiness**) sí consulta las dependencias (`DEPENDENCY_PROBES`:
 *   PostgreSQL y Redis desde F4-Q4). Responde "puedo atender tráfico", que es
 *   la pregunta que el balanceador necesita para dejar de enviarme peticiones.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(DEPENDENCY_PROBES)
    private readonly probes: DependencyProbe[],
  ) {}

  /** Liveness. Sin dependencias: solo el estado del proceso. */
  check(requestId?: string): HealthResponse {
    return {
      status: "ok",
      service: SERVICE_NAME,
      version: process.env.npm_package_version ?? "0.0.0",
      environment: process.env.NODE_ENV ?? "development",
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      ...(requestId ? { requestId } : {}),
    };
  }

  /**
   * Readiness. Devuelve 503 con `down` si **alguna** dependencia no responde,
   * para que el orquestador retire la instancia del balanceador sin matarla.
   *
   * Las sondas no lanzan (ver `DependencyProbe`), y además se envuelve cada una
   * en `probeSafely`: si algún día una lo hiciera, un `SELECT 1` que revienta se
   * traduciría en un 500 sin cuerpo, que es el peor resultado posible para un
   * diagnóstico.
   */
  async ready(requestId?: string): Promise<ReadinessResponse> {
    const dependencies = await Promise.all(
      this.probes.map((probe) => this.probeSafely(probe)),
    );
    const isUp = dependencies.every((dependency) => dependency.status === "up");

    return {
      status: isUp ? "ok" : "down",
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      dependencies,
      ...(requestId ? { requestId } : {}),
    };
  }

  /**
   * Cinturón sobre `DependencyProbe`, que ya está obligado a no lanzar.
   *
   * Se mantiene el try/catch aunque el contrato diga que no va a fallar,
   * porque el coste de que esa garantía se rompa es un 500 sin cuerpo en el
   * endpoint que existe justamente para decir qué está roto. Solo la clase del
   * error sale hacia fuera: los mensajes de `pg`/ioredis pueden incluir la DSN.
   */
  private async probeSafely(probe: DependencyProbe): Promise<DependencyStatus> {
    try {
      return await probe.check();
    } catch (error) {
      return {
        name: "unknown",
        status: "down",
        latencyMs: 0,
        error: error instanceof Error ? error.name : "UnknownError",
      };
    }
  }
}