/**
 * Claims del access token (docs/architecture/authentication.md §3).
 *
 * Prohibido incluir roles, permisos, límites o datos de negocio: el JWT
 * **no es fuente de verdad de autorización** (ADR-005). El rol se relee de
 * `memberships` en cada request.
 */
export interface AccessTokenClaims {
  /** `user_id`. */
  sub: string;
  /** `session_id` = raíz de la familia de refresh tokens. */
  jti: string;
  /** Tenant activo de la sesión. Contexto, NO autorización. */
  tenant_id: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface IssueAccessTokenInput {
  userId: string;
  sessionId: string;
  tenantId: string;
  /** TTL en segundos. */
  ttlSeconds: number;
  /** `iat`/`exp` resueltos aquí para que los tests sean deterministas. */
  now?: Date;
}

export interface AccessTokenIssuer {
  issue(input: IssueAccessTokenInput): Promise<string>;
  /** Lanza `AuthenticationError` si el token es inválido, expirado o ajeno. */
  verify(token: string): Promise<AccessTokenClaims>;
}
