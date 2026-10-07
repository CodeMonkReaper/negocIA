import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import type { DependencyProbe, DependencyStatus } from "../../domain/ports/dependency-probe";

const PROBE_NAME = "redis";

const PROBE_OPTIONS = {
  // El sondeo debe fallar rápido para no encolar el readiness check tras una
  // caída de red: un timeout de 1 s es suficiente para un PING local.
  connectTimeout: 1_000,
  commandTimeout: 1_000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => 100,
};

/**
 * Sonda de Redis para el readiness check (F4-Q4).
 *
 * A diferencia de la sonda de PostgreSQL (que reutiliza el cliente de Prisma),
 * aquí el cliente se crea y destruye por sondeo: el PING de Redis no necesita
 * estado, y así el probe no mantiene una conexión abierta de por vida en un
 * endpoint que corre pocas veces. Devuelve `down` (sin lanzar) y nunca expone
 * el mensaje de error, que con ioredis puede incluir el `password` de la URL.
 */
@Injectable()
export class RedisDependencyProbe implements DependencyProbe {
  constructor(private readonly connectionString: string) {}

  async check(): Promise<DependencyStatus> {
    const startedAt = performance.now();
    const client = new Redis(this.connectionString, PROBE_OPTIONS);

    try {
      const pong = await client.ping();
      return {
        name: PROBE_NAME,
        status: pong === "PONG" ? "up" : "down",
        latencyMs: elapsedMs(startedAt),
        ...(pong === "PONG"
          ? {}
          : { error: "UnexpectedResponseError" }),
      };
    } catch (error) {
      return {
        name: PROBE_NAME,
        status: "down",
        latencyMs: elapsedMs(startedAt),
        // Solo la clase del error: el texto de ioredis puede incluir el password.
        error: error instanceof Error ? error.name : "UnknownError",
      };
    } finally {
      client.disconnect();
    }
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}