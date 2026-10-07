import type { AccessTokenClaims } from "../../domain/ports/access-token-issuer";
import type { Principal, TenantContext } from "../../domain/tenant-context";

/**
 * Claims verificados del access token, adjuntos a la request por
 * `JwtAuthGuard`.
 *
 * Se guardan aparte del `Principal` a propósito: son los únicos datos
 * **firmados** y son la prueba criptográfica de identidad, mientras que el
 * `Principal` es una relectura de BD que además puede haber cambiado.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Claims del access token ya verificados. */
      authClaims?: AccessTokenClaims;
      /** Identidad+autorización resueltas desde BD en este request. */
      principal?: Principal;
      /** Contexto propagado por `AsyncLocalStorage` durante este request. */
      tenantContext?: TenantContext;
    }
  }
}

export {};
