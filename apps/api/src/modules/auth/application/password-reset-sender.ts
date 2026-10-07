import { Inject, Injectable } from "@nestjs/common";
import {
  EMAIL_SENDER,
  OPAQUE_TOKEN_GENERATOR,
  TOKEN_HASHER,
  UNIT_OF_WORK,
} from "../../../common/di-tokens";
import { computeTokenExpiry } from "../../../domain/session/refresh-session";
import type {
  EmailSender,
  OpaqueTokenGenerator,
  TokenHasher,
  UnitOfWork,
} from "../../../domain/ports";

/** Vida del token de reset (1-uso). Corto de propósito: solo sirve para una recuperación. */
export const RESET_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Datos estrictamente necesarios para emitir el email de reset.
 *
 * Misma filosofía que `VerificationRecipient`: no se pasa el hash ni las fechas
 * de auditoría de `UserRecord`.
 */
export interface ResetRecipient {
  id: string;
  email: string;
  name: string;
}

export interface ResetEmailResult {
  expiresAt: Date;
}

/**
 * Emisión del token de reset de contraseña (docs/api/authentication.md §9).
 *
 * Espejo de `EmailVerificationSender` con dominio propio:
 *
 *  - Token opaco de 1-uso, persistido **solo hasheado** y vencido a los 15 min.
 *  - Antes de emitir se invalidan los resets PENDING previos del usuario en la
 *    misma transacción: solo puede existir un reset vivo. Si el anterior se
 *    invalidara después, un atacante con el email robado conviviría con el
 *    legítimo y elegiría al azar cuál presentar.
 *  - El envío es best-effort (mismo patrón que la verificación): el token ya
 *    quedó persistido antes de `send`, así que un fallo del proveedor no rompe
 *    nada y el usuario puede volver a pedir el envío.
 */
@Injectable()
export class PasswordResetSender {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OPAQUE_TOKEN_GENERATOR)
    private readonly opaqueTokens: OpaqueTokenGenerator,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  async send(user: ResetRecipient): Promise<ResetEmailResult> {
    const token = this.opaqueTokens.generate();
    const now = new Date();
    const expiresAt = computeTokenExpiry(now, RESET_TOKEN_TTL_SECONDS);

    await this.unitOfWork.transaction(async (tx) => {
      await tx.passwordResetTokens.invalidatePendingByUser(user.id, now);
      await tx.passwordResetTokens.create({
        userId: user.id,
        tokenHash: this.tokenHasher.hashToken(token),
        expiresAt,
      });
    });

    await this.emailSender.send({
      to: user.email,
      template: "reset-password",
      data: { name: user.name },
      token,
      expiresAt,
    });

    return { expiresAt };
  }
}