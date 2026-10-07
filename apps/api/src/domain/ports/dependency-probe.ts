/**
 * Puerto de sonda de dependencias.
 *
 * Existe para que `HealthService` no importe Prisma. `dependency-rules.md` §2
 * exige que los casos de uso hablen con puertos, y un readiness check que
 * importa el cliente de base de datos para hacer `SELECT 1` es exactamente el
 * caso que la regla evita: si mañana el health check creciera para sondear
 * Redis, el acoplamiento ya estaría instalado.
 */
export interface DependencyProbe {
  /**
   * Sonda una dependencia y describe su estado.
   *
   * **No debe lanzar.** Devolver `down` con el motivo es preferible a propagar
   * el error: un readiness check que revienta convierte un diagnóstico
   * ("la BD no responde") en un 500 opaco, que es justo lo que se quiere evitar.
   */
  check(): Promise<DependencyStatus>;
}

export interface DependencyStatus {
  name: string;
  status: "up" | "down";
  /** Latencia del sondeo en milisegundos. Útil para distinguir lentitud de caída. */
  latencyMs: number;
  /** Motivo del fallo. Solo presente si `status` es `down`. */
  error?: string;
}
