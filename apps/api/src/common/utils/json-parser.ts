/**
 * Utilidades seguras para parseo de JSON desde responses HTTP.
 * 
 * Centraliza la lógica de error handling para evitar duplicación
 * de `.json().catch(() => null)` en múltiples lugares.
 */

/**
 * Parsea JSON desde un Response HTTP de forma segura.
 * 
 * Devuelve los datos parseados o null si falla el parseo.
 * No relanza excepciones para permitir workflows defensivos.
 * 
 * @param response Response HTTP de fetch/axios/etc
 * @returns Datos parseados o null en caso de error
 */
export async function safeJsonParse<T = unknown>(
  response: Response,
): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Parsea JSON desde un string de forma segura.
 * 
 * @param json String JSON
 * @returns Datos parseados o null en caso de error
 */
export function safeJsonParseString<T = unknown>(
  json: string,
): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
