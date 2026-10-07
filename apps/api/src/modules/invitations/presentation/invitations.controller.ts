import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  AcceptInvitationResponseDto,
  InvitationDto,
  VerifyEmailResponseDto,
} from "@negocia/contracts";
import type { Request } from "express";
import { toRequestMetadata } from "../../auth/application/request-metadata";
import { Roles } from "../../../common/guards/roles.decorator";
import type { Principal } from "../../../domain/tenant-context";
import { EmailVerificationService } from "../application/email-verification.service";
import { InvitationsService } from "../application/invitations.service";
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationIdParamDto,
  VerifyEmailTokenDto,
} from "./dto/invitation-input.dto";
import {
  toAcceptInvitationDto,
  toInvitationDto,
} from "./invitation.mapper";

/**
 * Invitaciones (docs/api/authentication.md §7).
 *
 * Todas las rutas son autenticadas salvo `accept`, que lo es **también**: se
 * necesita un `Principal` para comprobar que el token de la invitación es del
 * email autenticado. Un endpoint público sería más cómodo de integrar, pero
 * dejaría la comprobación en manos del cliente.
 */
@ApiTags("invitations")
@ApiBearerAuth()
@Controller("invitations")
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly verificationService: EmailVerificationService,
  ) {}

  /**
   * 201 y no 200: crea un recurso. El token **no** aparece en la respuesta; se
   * envió por email y en la base solo vive su hash.
   */
  @Post()
  @Roles("OWNER", "ADMIN")
  // Cifra deliberadamente holgada: `LimitsService` ya impide invitaciones por
  // encima del plan, así que el throttler solo cubre el abuso de un OWNER, que
  // puede crear y revocar invitaciones reales repetidamente.
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  @ApiOperation({
    summary: "Crear invitación",
    description:
      "Rol OWNER/ADMIN. Devuelve la invitación sin el token; este se envía por email y solo se almacena su hash.",
  })
  @ApiResponse({ status: 201, description: "Invitación creada y email enviado." })
  @ApiResponse({ status: 409, description: "Límite del plan, ya miembro o invitación pendiente." })
  async create(
    @Body() body: CreateInvitationDto,
    @Req() request: Request,
  ): Promise<InvitationDto> {
    const principal = request.principal as Principal;
    const invitation = await this.invitationsService.create({
      email: body.email,
      role: body.role,
      tenantId: principal.tenantId,
      invitedBy: principal.userId,
      invitedByRole: principal.role,
    });

    return toInvitationDto(invitation);
  }

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  // Aceptar **no** lleva `@Throttle` propio: el token es de un solo uso, así que
  // un intento fallido no abre la puerta a más intentos con ese mismo token. El
  // límite por defecto sigue aplicándose y es lo que evita el barrido de
  // tokens adivinados.
  @ApiOperation({
    summary: "Aceptar invitación",
    description:
      "Consume el token, crea la membresía y devuelve una sesión activa en el tenant invitado. 400 invalid_token para cualquier fallo del token.",
  })
  @ApiResponse({ status: 200, description: "Invitación aceptada y sesión emitida." })
  @ApiResponse({ status: 400, description: "Token inválido, vencido, usado o de otro email." })
  async accept(
    @Body() body: AcceptInvitationDto,
    @Req() request: Request,
  ): Promise<AcceptInvitationResponseDto> {
    const principal = request.principal as Principal;
    const result = await this.invitationsService.accept(
      { token: body.token, email: principal.email },
      toRequestMetadata(request.headers, request.ip),
    );

    return toAcceptInvitationDto(result);
  }

  /**
   * 204 sin cuerpo: revocar no tiene nada que devolver y un `200` con `{}`
   * haría que el cliente interpretara el objeto vacío como un estado.
   */
  @Delete(":id")
  @Roles("OWNER", "ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Revocar invitación",
    description:
      "Rol OWNER/ADMIN del tenant de la invitación. 404 si no existe o es de otro tenant, sin distinguir los dos casos.",
  })
  @ApiResponse({ status: 204, description: "Invitación revocada." })
  @ApiResponse({ status: 404, description: "La invitación no existe en este tenant." })
  @ApiResponse({ status: 409, description: "La invitación ya no está pendiente." })
  async revoke(
    @Param() params: InvitationIdParamDto,
    @Req() request: Request,
  ): Promise<void> {
    const principal = request.principal as Principal;
    await this.invitationsService.revoke(principal.tenantId, params.id);
  }
}

/**
 * Verificación de email (docs/api/authentication.md §8).
 *
 * Módulo aparte del de invitaciones porque el consumo del token no tiene nada
 * que ver con tenants: es system-scoped. Mezclarlos habría dejado un controller
 * con dos axes de autorización distintos (rol de tenant vs. identidad propia).
 */
@ApiTags("email-verification")
@ApiBearerAuth()
@Controller("email-verification")
export class EmailVerificationController {
  constructor(
    private readonly verificationService: EmailVerificationService,
  ) {}

  @Post("verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Verificar email",
    description:
      "Consume el token de un solo uso. 400 invalid_token para inválido, usado o vencido.",
  })
  @ApiResponse({ status: 200, description: "Email verificado." })
  @ApiResponse({ status: 400, description: "Token inválido, usado o vencido." })
  async verify(
    @Body() body: VerifyEmailTokenDto,
  ): Promise<VerifyEmailResponseDto> {
    return this.verificationService.verify(body.token);
  }

  @Post("resend")
  @HttpCode(HttpStatus.OK)
  // Rate limit propio y más estricto que el default: es la vía para regenerar
  // tokens sin límite, y el abuso convertiría la tabla en un almacén gratuito
  // de timestamps para quien tenga la contraseña de una sola cuenta.
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOperation({
    summary: "Reenviar verificación de email",
    description:
      "Invalida los tokens pendientes del usuario y emite uno nuevo. Rate limited.",
  })
  @ApiResponse({ status: 200, description: "Email reenviado, o nada si ya estaba verificado." })
  @ApiResponse({ status: 429, description: "Demasiados reenvíos." })
  async resend(@Req() request: Request): Promise<{ sent: boolean }> {
    const principal = request.principal as Principal;
    return this.verificationService.resend(
      {
        id: principal.userId,
        email: principal.email,
        name: principal.name,
        emailVerifiedAt: principal.emailVerifiedAt,
      },
      principal.tenantName,
    );
  }
}
