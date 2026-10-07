/**
 * Generador de IDs únicos para errores.
 *
 * Permite correlacionar errores HTTP con entradas de log sin exponer
 * stack traces en la respuesta.
 *
 * Formato: `ERR_<timestamp>_<random>`
 * Ejemplo: `ERR_1697856000123_a1b2c3d4`
 */

export function generateErrorId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `ERR_${timestamp}_${random}`;
}

/**
 * Extrae el timestamp de un error ID.
 * Útil para debugging (saber cuándo ocurrió el error).
 */
export function getErrorIdTimestamp(errorId: string): number | null {
  const parts = errorId.split("_");
  if (parts.length < 3) return null;
  try {
    return parseInt(parts[1], 36);
  } catch {
    return null;
  }
}
