import { Module } from "@nestjs/common";
import { LimitsService } from "../../domain/plans/limits-service";
import { AuthModule } from "../auth/auth.module";
import { EmailVerificationService } from "./application/email-verification.service";
import { InvitationsService } from "./application/invitations.service";
import {
  EmailVerificationController,
  InvitationsController,
} from "./presentation/invitations.controller";

/**
 * Módulo de onboarding: invitaciones y verificación de email.
 *
 * Importa `AuthModule` por dos servicios concretos:
 *  - `SessionService`, para emitir la sesión del tenant invitado en `accept`.
 *    La emisión vive allí porque la rotación de refresh y la detección de reuse
 *    son suyas; duplicar esa lógica en el módulo de invitaciones sería la vía
 *    más corta a una familia de tokens sin ancla.
 *  - `EmailVerificationSender`, que `accept` reutiliza para verificar el email
 *    del invitado con el mismo camino de código que `POST /verify`.
 *
 * `DatabaseModule` es global: los repositorios, incluidos los de invitaciones,
 * llegan sin importarlos.
 */
@Module({
  imports: [AuthModule],
  controllers: [InvitationsController, EmailVerificationController],
  providers: [InvitationsService, EmailVerificationService, LimitsService],
  exports: [InvitationsService, EmailVerificationService],
})
export class InvitationsModule {}
