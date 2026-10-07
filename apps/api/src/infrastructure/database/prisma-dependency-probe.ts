import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@negocia/database";
import type { DependencyProbe, DependencyStatus } from "../../domain/ports/dependency-probe";

const PROBE_NAME = "postgresql";

/**
 * Sonda de PostgreSQL para el readiness check.
 *
 * Usa `$queryRaw` con un `SELECT 1` literal en vez de un `SELECT count(*)` sobre
 * una tabla: el objetivo es comprobar que hay un socket y que el motor acepta
 * consultas, no que el esquema esté poblado. Un count sobre una tabla
 * distingue dos fallos que el orquestador no puede tratar igual (tabla vacía no
 * es lo mismo que base de datos caída) y confunde los dos con el mismo 503.
 *
 * `SELECT 1` se escribe como template crudo (`$queryRaw` tag) y no interpolado
 * porque no lleva entradas: una interpolación de texto aquí sería la clase
 * exacta de SQL injection que `dependency-rules` prohíbe, y con una constante
 * no hay forma de que aparezca.
 */
@Injectable()
export class PrismaDependencyProbe implements DependencyProbe {
  constructor(private readonly prisma: PrismaClient) {}

  async check(): Promise<DependencyStatus> {
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        name: PROBE_NAME,
        status: "up",
        latencyMs: elapsedMs(startedAt),
      };
    } catch (error) {
      // No relanza: `HealthService.ready` espera `status: "down"`, y un
      // rechazo aquí se convertiría en un 500 sin cuerpo, que es el peor
      // resultado para un endpoint cuyo propósito es diagnosticar.
      return {
        name: PROBE_NAME,
        status: "down",
        latencyMs: elapsedMs(startedAt),
        // Se registra la clase, no el mensaje: las credenciales de la URL de
        // conexión aparecen en el texto del error de pg, y `/api/health` es
        // `@Public()`. Enseñar el mensaje filtraría la DSN a cualquiera que
        // llame al endpoint.
        error: error instanceof Error ? error.name : "UnknownError",
      };
    }
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
