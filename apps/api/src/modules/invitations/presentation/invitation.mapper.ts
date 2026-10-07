import type { InvitationRecord } from "../../../domain/identity/entities";
import type {
  InvitationDto,
  AcceptInvitationResponseDto,
} from "@negocia/contracts";
import type { AcceptInvitationResult } from "../application/invitations.service";

/**
 * Mapeo de invitaciones a DTO.
 *
 * Proyección explícita, campo a campo, y no un `return row as InvitationDto`.
 * El motivo es concreto: la entidad de Prisma trae `tokenHash`, y un
 * `{ ...row }` lo dejaría en el JSON de la respuesta. Enumerar a mano es lo que
 * hace imposible ese fallo por descuido, y es la misma razón por la que
 * `auth.mapper.ts` no hace spread.
 */
export function toInvitationDto(invitation: InvitationRecord): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as InvitationDto["role"],
    status: invitation.status as InvitationDto["status"],
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    invitedBy: invitation.invitedBy,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    acceptedBy: invitation.acceptedBy,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  };
}

/**
 * La respuesta de `accept` **no** lleva la `membership` completa, solo sus dos
 * campos relevantes. `AcceptInvitationResponseDto` está declarado así en
 * `packages/contracts` porque el cliente no necesita el id de la membresía para
 * pintar nada, y cuanto menos viaja, menos superficie hay que mantener.
 */
export function toAcceptInvitationDto(
  result: AcceptInvitationResult,
): AcceptInvitationResponseDto {
  return {
    tenantId: result.tenantId,
    tenantName: result.tenantName,
    role: result.role,
    status: result.status,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    sessionId: result.sessionId,
    expiresIn: result.expiresIn,
  };
}
