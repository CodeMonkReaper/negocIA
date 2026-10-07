import { Inject, Injectable } from "@nestjs/common";
import {
  ACCESS_TOKEN_ISSUER,
  ID_GENERATOR,
  OPAQUE_TOKEN_GENERATOR,
  TOKEN_HASHER,
  UNIT_OF_WORK,
} from "../../../common/di-tokens";
import type { RefreshTokenRecord } from "../../../domain/identity/entities";
import type {
  AccessTokenIssuer,
  IdGenerator,
  OpaqueTokenGenerator,
  TokenHasher,
  UnitOfWork,
} from "../../../domain/ports";
import { computeTokenExpiry } from "../../../domain/session/refresh-session";
import { StructuredLogger } from "../../../common/logger/structured-logger";
// Import **con valor**, no `import type`: Nest lee el tipo del parámetro del
// constructor por reflexión para resolver el token de inyección, y un
// `import type` desaparece en tiempo de ejecución, dejando el índice sin
// resolver y el arranque fallando con "Nest can't resolve dependencies".
import { AuthConfigService } from "./auth-config.service";
import type { RequestMetadata } from "./request-metadata";

/**
 * Señal interna de "el token ya fue rotado por otro proceso".
 *
 * Viaja como excepción (y no como valor de retorno) porque se lanza desde
 * dentro de la transacción para que el rollback deshaga también la creación
 * del token sucesor: si el INSERT sobreviviera, la familia quedaría con dos
 * ramas y el token robado seguiría sirviendo.
 */
export class RefreshAlreadyRotatedError extends Error {
  constructor() {
    super("REFRESH_ALREADY_ROTATED");
    this.name = "RefreshAlreadyRotatedError";
  }
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

@Injectable()
export class SessionService {
  private readonly logger = StructuredLogger.fromEnv();

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(ACCESS_TOKEN_ISSUER)
    private readonly accessTokenIssuer: AccessTokenIssuer,
    @Inject(OPAQUE_TOKEN_GENERATOR)
    private readonly opaqueTokens: OpaqueTokenGenerator,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly config: AuthConfigService,
  ) {}

  /**
   * Abre una sesión: 1 access JWT + 1 refresh token opaco.
   *
   * El `id` de la fila raíz se genera en la aplicación para poder escribir
   * `session_id = id` en el mismo INSERT; si se dejara a
   * `gen_random_uuid()` haría falta un segundo viaje a la base de datos para
   * conocer el id que debe anclar a la familia.
   */
  async issue(input: {
    userId: string;
    tenantId: string;
    meta?: RequestMetadata;
    now?: Date;
  }): Promise<IssuedSession> {
    const now = input.now ?? this.config.now();
    const sessionId = this.ids.next();
    const refreshToken = this.opaqueTokens.generate();
    const expiresAt = computeTokenExpiry(now, this.config.refreshTtlSeconds);

    await this.unitOfWork.transaction((tx) =>
      tx.refreshTokens.create({
        id: sessionId,
        userId: input.userId,
        sessionId,
        tenantId: input.tenantId,
        tokenHash: this.tokenHasher.hashToken(refreshToken),
        expiresAt,
        ip: input.meta?.ip ?? null,
        userAgent: input.meta?.userAgent ?? null,
      }),
    );

    const accessToken = await this.accessTokenIssuer.issue({
      userId: input.userId,
      sessionId,
      tenantId: input.tenantId,
      ttlSeconds: this.config.accessTtlSeconds,
      now,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTtlSeconds,
      sessionId,
    };
  }

  /**
   * Rotación (authentication.md §5, paso 5).
   *
   * Orden dentro de la transacción: primero se crea el sucesor y después se
   * revoca el predecesor con `revokeIfActive` (UPDATE condicional sobre
   * `revoked_at IS NULL`). Si dos requests presentan el mismo token a la vez,
   * solo uno obtiene `true`; el otro aborta con
   * `RefreshAlreadyRotatedError` y su INSERT se deshace con el rollback, de
   * modo que nunca se emiten dos access tokens para la misma rotación —eso
   * dejaría sin efecto la detección de reuse que justifica el mecanismo.
   */
  async rotate(input: {
    current: RefreshTokenRecord;
    userId: string;
    meta?: RequestMetadata;
    now?: Date;
  }): Promise<IssuedSession> {
    const now = input.now ?? this.config.now();
    const nextId = this.ids.next();
    const refreshToken = this.opaqueTokens.generate();
    const expiresAt = computeTokenExpiry(now, this.config.refreshTtlSeconds);

    try {
      await this.unitOfWork.transaction(async (tx) => {
        await tx.refreshTokens.create({
          id: nextId,
          userId: input.userId,
          sessionId: input.current.sessionId,
          tenantId: input.current.tenantId,
          tokenHash: this.tokenHasher.hashToken(refreshToken),
          expiresAt,
          ip: input.meta?.ip ?? null,
          userAgent: input.meta?.userAgent ?? null,
        });

        const revoked = await tx.refreshTokens.revokeIfActive(
          input.current.id,
          now,
          nextId,
        );

        if (!revoked) {
          throw new RefreshAlreadyRotatedError();
        }
      });
    } catch (error) {
      if (error instanceof RefreshAlreadyRotatedError) {
        // Registrar el evento de race condition para auditoría de seguridad
        this.logger.warn(
          "Session refresh race condition detected",
          "SessionService",
          {
            userId: input.userId,
            sessionId: input.current.sessionId,
            tokenId: input.current.id,
            ip: input.meta?.ip,
          },
        );
      }
      throw error;
    }

    const accessToken = await this.accessTokenIssuer.issue({
      userId: input.userId,
      sessionId: input.current.sessionId,
      tenantId: input.current.tenantId,
      ttlSeconds: this.config.accessTtlSeconds,
      now,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTtlSeconds,
      sessionId: input.current.sessionId,
    };
  }

  /** Revoca toda la familia viva de la sesión. */
  async revokeFamily(sessionId: string, now?: Date): Promise<number> {
    const at = now ?? this.config.now();
    return this.unitOfWork.transaction((tx) =>
      tx.refreshTokens.revokeFamily(sessionId, at),
    );
  }

  /** Revoca todas las familias vivas del usuario. */
  async revokeAllForUser(userId: string, now?: Date): Promise<number> {
    const at = now ?? this.config.now();
    return this.unitOfWork.transaction((tx) =>
      tx.refreshTokens.revokeAllForUser(userId, at),
    );
  }
}
