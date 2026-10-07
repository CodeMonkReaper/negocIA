/**
 * Sanitización de datos sensibles en logs.
 *
 * Reemplaza valores de claves sensibles con `[REDACTED]` para evitar
 * exponer tokens, contraseñas u otros datos confidenciales en logs.
 */

const SENSITIVE_KEYS = [
  "password",
  "token",
  "refreshToken",
  "accessToken",
  "secret",
  "apiKey",
  "api_key",
  "encryptionKey",
  "encryption_key",
  "jwtSecret",
  "jwt_secret",
  "sessionId",
  "session_id",
  "metaSecret",
  "meta_secret",
  "metaAppSecret",
  "meta_app_secret",
  "encryptedToken",
  "encrypted_token",
  "privateKey",
  "private_key",
  "publicKey",
  "public_key",
  "Authorization",
  "authorization",
  "X-API-Key",
  "x-api-key",
];

/**
 * Sanitiza un objeto reemplazando valores de claves sensibles.
 *
 * Itera recursivamente sobre propiedades del objeto. Si una clave
 * coincide con la lista de sensibles, reemplaza el valor con
 * `[REDACTED]`.
 *
 * @param obj El objeto a sanitizar
 * @param depth Profundidad máxima para recursión (evita bucles infinitos)
 * @returns Copia sanitizada del objeto
 */
export function sanitizeLogData(
  obj: unknown,
  depth = 0,
): unknown {
  if (depth > 10) return "[MAX_DEPTH]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeLogData(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
