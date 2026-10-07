import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthenticationError } from "../../domain/errors";
import { ACCESS_TOKEN_ISSUER } from "../di-tokens";
import type { AccessTokenIssuer } from "../../domain/ports/access-token-issuer";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { Request } from "express";

/**
 * Verifica el access token y lo adjunta a la request.
 *
 * No resuelve rol ni estado: eso es trabajo de `TenantContextGuard`, contra
 * BD. Este guard solo responde "¿esta petición viene de alguien que sabe el
 * secreto de firma?".
 *
 * Registrado como `APP_GUARD` global: fail-closed por omisión, con
 * `@Public()` como única excepción.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokenIssuer: AccessTokenIssuer,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      // Sin cabecera `Authorization` la petición es anónima. El `WWW-Authenticate`
      // del 401 dice qué se esperaba, como manda RFC 9110 §15.4.
      throw new AuthenticationError(
        "invalid_credentials",
        "Falta la cabecera Authorization: Bearer",
      );
    }

    request.authClaims = await this.accessTokenIssuer.verify(token);
    return true;
  }
}

/**
 * Extrae el token de `Authorization: Bearer <token>`.
 *
 * Se rechaza cualquier otro esquema (`Basic`, `Token`): aceptar varios
 * esquemas haría que un proxy o un cliente mal configurado acabara
 * interpretando un valor distinto como JWT.
 */
function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || rest.length !== 1) {
    return null;
  }
  return rest[0]?.length ? rest[0] : null;
}
