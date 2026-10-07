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

/** Vida del token de verificación de email (1-uso). */
export const VERIFICATION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export interface VerificationEmailResult {
  /** `false` si el usuario ya tenía el email verificado: no se envía nada. */
  sent: boolean;
  expiresAt: Date;
}

/**
 * Datos estrictamente necesarios para emitir el email.
 *
 * Deliberadamente más estrecho que `UserRecord`: ni el hash de contraseña, ni
 * el status, ni las fechas de auditoría participan en este envío. Declararlo
 * ancho obligaría a quien solo tiene un `Principal` a inventar `passwordHash: ""`
 * y fechas en epoch para cumplir la firma.
 */
export interface VerificationRecipient {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
}

/**
 * Emisión del token de verificación de email.
 *
 * Existe como servicio aparte, y no como método privado de `AuthService`, por
 * dos razones concretas:
 *
 *  1. `POST /v1/email-verification/resend` necesita exactamente esta lógica y
 *     no la tenía accesible. Duplicarla habría sido peor: las dos copias
 *     divergirían en el TTL o en el hasheado sin que nada lo señalara.
 *  2. `AuthService` depende de `SessionService` y de la rotación de refresh;
 *     un reenvío de email no tiene ninguna relación con eso. Un servicio
 *     pequeño con sus tres puertos hace la dependencia explícita.
 */
@Injectable()
export class EmailVerificationSender {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(OPAQUE_TOKEN_GENERATOR)
    private readonly opaqueTokens: OpaqueTokenGenerator,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  /**
   * Crea el token, lo persiste hasheado y lo envía por email.
   *
   * **El token crudo no se persiste ni se registra**: solo sale en el mensaje.
   * Un dump de la tabla `verification_tokens` no debe permitir verificar emails.
   *
   * La escritura y el envío son operaciones separadas a propósito. Si el
   * proveedor falla, el token queda en la base y el usuario puede pedir el
   * reenvío; el orden inverso dejaría tokens emitidos que nadie puede usar
   * porque el registro falló.
   */
  async send(
    user: VerificationRecipient,
    tenantName: string,
  ): Promise<VerificationEmailResult> {
    if (user.emailVerifiedAt) {
      return { sent: false, expiresAt: new Date(0) };
    }

    const token = this.opaqueTokens.generate();
    const expiresAt = computeTokenExpiry(
      new Date(),
      VERIFICATION_TOKEN_TTL_SECONDS,
    );

    await this.unitOfWork.transaction((tx) =>
      tx.verificationTokens.create({
        userId: user.id,
        tokenHash: this.tokenHasher.hashToken(token),
        expiresAt,
      }),
    );

    await this.emailSender.send({
      to: user.email,
      template: "verification",
      data: { name: user.name, tenantName },
      token,
      expiresAt,
    });

    return { sent: true, expiresAt };
  }
}
