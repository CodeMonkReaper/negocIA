import { SignJWT, jwtVerify } from "jose";
import { AuthenticationError } from "../../domain/errors";
import type {
  AccessTokenClaims,
  AccessTokenIssuer,
  IssueAccessTokenInput,
} from "../../domain/ports/access-token-issuer";

export interface JwtAccessTokenIssuerOptions {
  secret: string;
  issuer: string;
  audience: string;
  /** Longitud mínima exigida al secreto (longitud de la clave en bytes). */
  minSecretBytes?: number;
}

/** Algoritmo fijo en código, nunca leído del entorno. */
const ALGORITHM = "HS256";

/**
 * Emisor/verificador del access JWT (docs/architecture/authentication.md §3,
 * ADR-005).
 *
 * El algoritmo se fija como constante `HS256` en lugar de venir del entorno
 * a propósito: si `JWT_ALGORITHM` fuera configurable, un despliegue mal
 * configurado con `none` (o un cambio a RS256 interpretando la clave pública
 * como la privada) habilitaría la familia clásica de ataques de confusión de
 * algoritmo contra la librería de JWT.
 */
export class JwtAccessTokenIssuer implements AccessTokenIssuer {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(options: JwtAccessTokenIssuerOptions) {
    const secret = options.secret;
    if (Buffer.byteLength(secret, "utf8") < (options.minSecretBytes ?? 32)) {
      // Falla al arrancar y no en el primer login: un secreto débil en
      // producción es un incidente, no un detalle de configuración.
      throw new Error(
        `JWT_SECRET debe tener al menos ${options.minSecretBytes ?? 32} bytes (HS256); recibido ${Buffer.byteLength(secret, "utf8")}`,
      );
    }

    this.key = new TextEncoder().encode(secret);
    this.issuer = options.issuer;
    this.audience = options.audience;
  }

  async issue(input: IssueAccessTokenInput): Promise<string> {
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);

    return new SignJWT({ tenant_id: input.tenantId })
      .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
      .setSubject(input.userId)
      .setJti(input.sessionId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + input.ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: this.issuer,
        audience: this.audience,
        // `clockTolerance` cubre el desfase habitual entre máquinas sin abrir
        // la ventana a un token realmente expirado.
        clockTolerance: 5,
      });

      const { sub, jti, tenant_id: tenantId } = payload as Record<
        string,
        unknown
      >;

      if (
        typeof sub !== "string" ||
        typeof jti !== "string" ||
        typeof tenantId !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number" ||
        typeof payload.iss !== "string" ||
        typeof payload.aud !== "string"
      ) {
        throw new AuthenticationError(
          "invalid_credentials",
          "Token de acceso malformado",
        );
      }

      return {
        sub,
        jti,
        tenant_id: tenantId,
        iss: payload.iss,
        aud: payload.aud,
        iat: payload.iat,
        exp: payload.exp,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      // Todos los fallos de `jose` (firma, expiración, issuer, audience,
      // formato) se colapsan en un mismo 401: distinguirlos en el mensaje
      // ayudaría a un atacante a entender el endpoint.
      throw new AuthenticationError(
        "invalid_credentials",
        "Token de acceso inválido o expirado",
      );
    }
  }
}
