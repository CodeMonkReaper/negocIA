import { Inject, Injectable } from "@nestjs/common";
import { TOKEN_HASHER, UNIT_OF_WORK } from "../../../common/di-tokens";
import { InvalidTokenError } from "../../../domain/errors";
import type {
  TokenHasher,
  UnitOfWork,
} from "../../../domain/ports";
import {
  EmailVerificationSender,
  type VerificationRecipient,
} from "../../auth/application/email-verification-sender";

export interface VerifyEmailResult {
  emailVerifiedAt: string;
}

export interface ResendVerificationResult {
  /** `false` si el email ya estaba verificado y no se envió nada. */
  sent: boolean;
}

export type { VerificationRecipient };

/**
 * Resultado interno de la transacción de `verify`.
 *
 * Existe por el caso del token vencido: hay que **commitear** su consumo y
 * **después** lanzar. Un único tipo de retorno habría obligado a elegir entre
 * las dos cosas, y elegir mal significa que o el `throw` deshace el `markUsed`
 * o el token vencido sigue vivo.
 */
type VerifyOutcome =
  | { kind: "verified"; emailVerifiedAt: Date }
  | { kind: "expired" };

/**
 * Verificación de email (docs/api/authentication.md §8).
 *
 * El token se persiste **solo hasheado** (SHA-256). El crudo existe únicamente
 * en el mensaje de email, y ese es el motivo de que `findByTokenHash` sea un
 * `findUnique`: es un valor de alta cardinalidad y un índice único, no un
 * escaneo.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    private readonly sender: EmailVerificationSender,
  ) {}

  /**
   * Consume el token y marca `email_verified_at`.
   *
   * **No se comprueba que el token pertenezca al principal.** El token *es* la
   * prueba: quien lo posee es el dueño del email. Atar el consumo a
   * `request.userId` impediría verificar desde otro dispositivo, que es un caso
   * legítimo y frecuente (se registra en el móvil, abre el email en el
   * portátil).
   */
  async verify(token: string): Promise<VerifyEmailResult> {
    const tokenHash = this.tokenHasher.hashToken(token);
    const now = new Date();

    const outcome = await this.unitOfWork.transaction<VerifyOutcome>(
      async (tx) => {
        const record = await tx.verificationTokens.findByTokenHash(tokenHash);

        // Un solo código para inválido / usado / vencido. Ver el comentario de
        // `InvitationsService.accept`: distinguir los casos sirve de oráculo.
        if (!record || record.usedAt !== null) {
          throw new InvalidTokenError();
        }

        if (record.expiresAt.getTime() <= now.getTime()) {
          // Se consume y se confirma, pero el error se lanza fuera de la
          // transacción: un `throw` aquí haría rollback y el token vencido
          // seguiría siendo reutilizable si alguien corrigiera la fila.
          await tx.verificationTokens.markUsed(record.id, now);
          return { kind: "expired" };
        }

        // `markUsed` con `usedAt: null` en el `where` es lo que hace que el token
        // sea de un solo uso bajo concurrencia: la segunda transacción obtiene
        // `false` y cae en el `invalid_token` de arriba.
        if (!(await tx.verificationTokens.markUsed(record.id, now))) {
          throw new InvalidTokenError();
        }

        const user = await tx.users.markEmailVerified(record.userId, now);

        return {
          kind: "verified",
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        };
      },
    );

    if (outcome.kind === "expired") {
      throw new InvalidTokenError();
    }

    return { emailVerifiedAt: outcome.emailVerifiedAt.toISOString() };
  }

  /**
   * Reenvía el email con un token nuevo e invalida el anterior.
   *
   * Invalidar antes de emitir es lo que evita que dos emails válidos convivan:
   * si el anterior se invalidara después, un cliente que ya recibió el primero
   * podría aceptarlo y el reenvío no habría servido de nada.
   */
  async resend(
    user: VerificationRecipient,
    tenantName: string,
  ): Promise<ResendVerificationResult> {
    if (user.emailVerifiedAt) {
      return { sent: false };
    }

    await this.unitOfWork.transaction((tx) =>
      tx.verificationTokens.invalidatePendingByUser(user.id, new Date()),
    );

    const result = await this.sender.send(user, tenantName);

    return { sent: result.sent };
  }
}
