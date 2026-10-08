import { Redis } from "ioredis";

/**
 * Subconjunto de `ioredis` que epub/publisher realtime usan, tipado suelto
 * para que los tests puedan inyectar un doble sin arrastrar la librería.
 */
export interface RealtimeRedis {
  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: unknown[]): Promise<unknown>;
  quit(): Promise<"OK">;
}

export const REALTIME_CHANNEL = "negocia:realtime";

export function createRealtimeRedis(connectionString: string): RealtimeRedis {
  return new Redis(connectionString, { maxRetriesPerRequest: null });
}