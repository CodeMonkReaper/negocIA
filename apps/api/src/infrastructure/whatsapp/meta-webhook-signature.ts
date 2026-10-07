import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación del webhook de Meta (X-Hub-Signature-256).
 *
 * Meta firma el cuerpo crudo del POST con `HMAC-SHA256(app_secret, rawBody)` y
 * la envía en el header. La comparación debe ser constant-time
 * (`timingSafeEqual`) y sobre los bytes del body tal como llegaron, por eso el
 * controller trabaja con `req.rawBody` y no con el JSON ya parseado.
 */
export function isValidHubSignature(
  rawBody: Buffer,
  appSecret: string,
  received: string | undefined,
): boolean {
  if (!received || rawBody.length === 0) {
    return false;
  }

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const receivedHex = received.startsWith("sha256=")
    ? received.slice("sha256=".length)
    : received;

  let expectedBuffer: Buffer;
  try {
    expectedBuffer = Buffer.from(expected, "hex");
  } catch {
    return false;
  }

  try {
    return (
      receivedHex.length === expectedBuffer.length * 2 &&
      timingSafeEqual(
        expectedBuffer,
        Buffer.from(receivedHex, "hex"),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Validación del verify token del GET /webhook (mensaje de suscripción).
 *
 * Meta llama `GET /webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`
 * cuando se configura la suscripción; la app debe devolver `hub.challenge`
 * únicamente si `hub.mode` es `subscribe` y el token coincide. Sin
 * comparación timing-safe: el verify token no es un secreto criptográfico
 * (es un valor de suscripción), pero igual se usa una comparación de longitud
 * constante por costumbre.
 */
export function isHubSubscribeRequest(
  query: Record<string, unknown>,
  verifyToken: string,
): boolean {
  const mode = typeof query["hub.mode"] === "string" ? query["hub.mode"] : undefined;
  const token =
    typeof query["hub.verify_token"] === "string"
      ? query["hub.verify_token"]
      : undefined;

  if (mode !== "subscribe" || !token) {
    return false;
  }

  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function hubChallenge(
  query: Record<string, unknown>,
): string | undefined {
  const challenge =
    typeof query["hub.challenge"] === "string" ? query["hub.challenge"] : undefined;
  return challenge;
}