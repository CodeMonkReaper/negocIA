import { Inject, Injectable } from "@nestjs/common";
import {
  AuthorizationError,
  ConflictError,
  InvalidTokenError,
  NotFoundError,
} from "../../../domain/errors";
import {
  EMAIL_SENDER,
  INVITATION_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  OPAQUE_TOKEN_GENERATOR,
  TOKEN_HASHER,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from "../../../common/di-tokens";
import { normalizeEmail } from "../../../domain/identity/email";
import type {
  InvitationRecord,
  MembershipRecord,
  TenantRecord,
} from "../../../domain/identity/entities";
import {
  canInviteRole,
  isRole,
  type Role,
} from "../../../domain/identity/roles";
import { LimitsService } from "../../../domain/plans/limits-service";
import type {
  EmailSender,
  InvitationRepository,
  MembershipRepository,
  OpaqueTokenGenerator,
  TokenHasher,
  TransactionScope,
  UnitOfWork,
  UserRepository,
} from "../../../domain/ports";
import { computeTokenExpiry } from "../../../domain/session/refresh-session";
import type { RequestMetadata } from "../../auth/application/request-metadata";
import {
  SessionService,
  type IssuedSession,
} from "../../auth/application/session.service";

/** Vida de una invitación (ADR-008). */
export const INVITATION_TTL_SECONDS = 48 * 60 * 60;

export interface CreateInvitationCommand {
  email: string;
  role: Role;
  /** `tenantId` del contexto; nunca del body (dependency-rules.md §3.5). */
  tenantId: string;
  invitedBy: string;
  /** Rol del actor en el tenant, resuelto desde BD por el guard (matriz). */
  invitedByRole: Role;
}

export interface AcceptInvitationCommand {
  token: string;
  /** Email del principal autenticado: la invitación debe ser para él. */
  email: string;
}

export interface AcceptInvitationResult extends IssuedSession {
  tenantId: string;
  tenantName: string;
  role: Role;
  status: string;
  membership: MembershipRecord;
}

interface AcceptedInvitation {
  invitation: InvitationRecord;
  tenant: TenantRecord;
  membership: MembershipRecord;
}

/** Traduce el `P2002` de Prisma a un error de dominio. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Onboarding de miembros de un tenant (ADR-008).
 *
 * Tres operaciones con tres riesgos distintos que conviene no confundir:
 *
 *  - `create` la ejecuta alguien que ya es OWNER/ADMIN. El riesgo es de
 *    negocio: superar el plan, duplicar invitación, invitar a un miembro.
 *  - `accept` la ejecuta quien tiene el token, y por tanto **no** es de fiar.
 *    Es el único punto donde alguien sin relación con el tenant puede intentar
 *    algo. Todo lo que no sea exactamente "token válido, PENDING, sin vencer y
 *    del email autenticado" devuelve el mismo `invalid_token`.
 *  - `revoke` la ejecuta un OWNER/ADMIN pero sobre un id que viene de la URL:
 *    si la invitación es de otro tenant la respuesta es 404, no 403, para no
 *    confirmar que ese id existe.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitations: InvitationRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(OPAQUE_TOKEN_GENERATOR)
    private readonly opaqueTokens: OpaqueTokenGenerator,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
    private readonly limits: LimitsService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /**
   * Crea la invitación y envía el email.
   *
   * El token se persiste **solo hasheado** y sale en claro únicamente por el
   * `EmailSender`. Por eso el DTO de respuesta no tiene ningún campo de token:
   * no hay ninguno que devolver.
   */
  async create(command: CreateInvitationCommand): Promise<InvitationRecord> {
    // Matriz de invitación (roles.ts): un ADMIN no puede invitar a un OWNER.
    // Solo el `@Roles` del controller no bastaba para esta regla: el DTO acepta
    // cualquier rol del CHECK y la autorización real depende del actor.
    if (!canInviteRole(command.invitedByRole, command.role)) {
      throw new AuthorizationError(
        "forbidden",
        "No puedes invitar con ese rol",
      );
    }

    const email = normalizeEmail(command.email);
    const now = new Date();
    const expiresAt = computeTokenExpiry(now, INVITATION_TTL_SECONDS);
    const token = this.opaqueTokens.generate();

    // Fuera de la transacción: expirar lo vencido no depende de la creación y
    // hacerlo dentro haría que un rollback posterior deshaciera la limpieza,
    // dejando el índice parcial ocupado por una invitación muerta.
    await this.expireStale(command.tenantId, now);

    const { invitation, tenant } = await this.unitOfWork.transaction(
      async (tx) => {
        const tenant = await this.requireTenant(command.tenantId, tx);

        if (await this.isMemberOf(tx.memberships, command.tenantId, email)) {
          throw new ConflictError(
            "already_member",
            "El correo ya pertenece a este tenant",
          );
        }

        if (
          await tx.invitations.findPendingByTenantAndEmail(
            command.tenantId,
            email,
          )
        ) {
          throw new ConflictError(
            "invitation_pending",
            "Ya existe una invitación pendiente para ese correo",
          );
        }

        this.limits.assertUnderLimit(
          await tx.memberships.countActiveByTenant(command.tenantId),
          "maxUsers",
          tenant.plan,
        );

        try {
          const created = await tx.invitations.create({
            tenantId: command.tenantId,
            email,
            role: command.role,
            invitedBy: command.invitedBy,
            tokenHash: this.tokenHasher.hashToken(token),
            expiresAt,
          });
          return { invitation: created, tenant };
        } catch (error) {
          // El índice parcial `(tenant_id, email) WHERE status='PENDING'` es la
          // defensa real contra dos invitaciones simultáneas al mismo email:
          // el `find` anterior no las serializa, la constraint sí.
          if (isUniqueViolation(error)) {
            throw new ConflictError(
              "invitation_pending",
              "Ya existe una invitación pendiente para ese correo",
            );
          }
          throw error;
        }
      },
    );

    await this.emailSender.send({
      to: email,
      template: "invitation",
      data: {
        tenantName: tenant.name,
        role: command.role,
      },
      token,
      expiresAt,
    });

    return invitation;
  }

  /**
   * Acepta la invitación y emite sesión en el tenant invitado.
   *
   * **Transaccional de punta a punta**: consumir el token, crear la membresía y
   * verificar el email son una sola operación. Aceptada sin membresía dejaría un
   * token de un solo uso consumido sin efecto, que no se puede reparar.
   *
   * `maxUsers` se revalida aquí aunque ya se comprobara al invitar: entre ambos
   * momentos pueden entrar otras invitaciones, y el conteo en el momento del
   * accept es el único que puede garantizar el límite.
   */
  async accept(
    command: AcceptInvitationCommand,
    meta: RequestMetadata = {},
  ): Promise<AcceptInvitationResult> {
    const email = normalizeEmail(command.email);
    const user = await this.users.findByEmail(email);

    // El principal está autenticado (lo garantiza `JwtAuthGuard`), así que un
    // `invalid_token` aquí significaría una sesión de un usuario que ya no
    // existe. Se degrada a `invalid_token` para no abrir un canal de
    // enumeración de cuentas sobre el mismo endpoint.
    if (!user || user.status !== "ACTIVE") {
      throw new InvalidTokenError();
    }

    const tokenHash = this.tokenHasher.hashToken(command.token);
    const now = new Date();

    // Lectura previa fuera de la transacción, solo para poder responder
    // distinto a "vencido" (marcándolo `EXPIRED`) sin que ese `markExpired`
    // se deshaga con el rollback del `throw`.
    const preview = await this.invitations.findByTokenHash(tokenHash);

    if (preview && preview.status === "PENDING" && this.isExpired(preview, now)) {
      await this.unitOfWork.transaction((tx) =>
        tx.invitations.markExpired(preview.id),
      );
    }

    const accepted = await this.unitOfWork.transaction(async (tx) => {
      const invitation = await tx.invitations.findByTokenHash(tokenHash);

      // **Un único error para todos los fallos.** Distinguir "no existe" de
      // "ya se usó" convertiría este endpoint en un oráculo que revela si un
      // email ajeno tiene una invitación viva.
      if (!invitation || invitation.status !== "PENDING") {
        throw new InvalidTokenError();
      }

      if (this.isExpired(invitation, now)) {
        throw new InvalidTokenError();
      }

      if (invitation.email !== email) {
        throw new InvalidTokenError();
      }

      const tenant = await this.requireTenant(invitation.tenantId, tx);

      this.limits.assertUnderLimit(
        await tx.memberships.countActiveByTenant(invitation.tenantId),
        "maxUsers",
        tenant.plan,
      );

      // `consume` devuelve `false` si otra aceptación se adelantó. El `throw`
      // va **dentro** de la transacción a propósito: así el rollback deshace
      // también la membresía que se hubiera creado.
      const consumed = await tx.invitations.consume(invitation.id, {
        acceptedAt: now,
        acceptedBy: user.id,
      });
      if (!consumed) {
        throw new InvalidTokenError();
      }

      let membership: MembershipRecord;
      try {
        membership = await tx.memberships.create({
          tenantId: invitation.tenantId,
          userId: user.id,
          role: isRole(invitation.role) ? invitation.role : "AGENT",
          status: "ACTIVE",
        });
      } catch (error) {
        // P2002 sobre `memberships_tenant_id_user_id_key`: ya es miembro. Es un
        // resultado esperado de un reintento, no una avería.
        if (isUniqueViolation(error)) {
          throw new ConflictError(
            "already_member",
            "Ya perteneces a este tenant",
          );
        }
        throw error;
      }

      if (!user.emailVerifiedAt) {
        await tx.users.markEmailVerified(user.id, now);
      }

      return { invitation, tenant, membership } satisfies AcceptedInvitation;
    });

    // La sesión se emite **fuera** de la transacción: firmar el JWT y escribir
    // el refresh token no debe ampliar el lock sobre la invitación, y si la
    // emisión fallara la invitación queda consumida y consistente, que es
    // preferible a una invitación viva sin sesión.
    const session = await this.sessions.issue({
      userId: user.id,
      tenantId: accepted.invitation.tenantId,
      meta,
    });

    return {
      ...session,
      tenantId: accepted.tenant.id,
      tenantName: accepted.tenant.name,
      role: accepted.membership.role as Role,
      status: accepted.membership.status,
      membership: accepted.membership,
    };
  }

  /**
   * Revoca una invitación del tenant activo.
   *
   * 404 (no 403) si no existe **o** es de otro tenant: responder "ese id existe
   * pero no es tuyo" ya filtra información de otro tenant.
   */
  async revoke(tenantId: string, invitationId: string): Promise<void> {
    await this.unitOfWork.transaction(async (tx) => {
      const invitation = await tx.invitations.findById(invitationId);

      if (!invitation || invitation.tenantId !== tenantId) {
        throw new NotFoundError(
          "invitation_not_found",
          "Invitación no encontrada",
        );
      }

      if (invitation.status !== "PENDING") {
        throw new ConflictError(
          "conflict",
          "La invitación ya no está pendiente",
          { status: invitation.status },
        );
      }

      // El `updateMany` condicional es atómico, pero su `false` **sí** hay que
      // mirar: entre el `findById` de arriba y este punto otra request pudo
      // revocar o dejar vencer la invitación. Sin este chequeo esa request
      // ganaría en silencio y el 204 sería mentira.
      if (!(await tx.invitations.revoke(invitationId, new Date()))) {
        throw new ConflictError(
          "conflict",
          "La invitación ya no está pendiente",
        );
      }
    });
  }

  /**
   * Marca `EXPIRED` las invitaciones vencidas del tenant (expiración perezosa,
   * ADR-008).
   *
   * Sin job activo, la limpieza ocurre cuando alguien vuelve a mirar el
   * tenant. Lo que sí hace falta es liberar el índice parcial
   * `(tenant_id, email) WHERE status='PENDING'`, que es lo que impide volver a
   * invitar a alguien cuya invitación ya venció.
   */
  private async expireStale(tenantId: string, now: Date): Promise<void> {
    const expired = await this.invitations.listExpiredPending(tenantId, now);
    if (expired.length === 0) return;

    await this.unitOfWork.transaction(async (tx) => {
      for (const invitation of expired) {
        await tx.invitations.markExpired(invitation.id);
      }
    });
  }

  private isExpired(invitation: InvitationRecord, now: Date): boolean {
    return invitation.expiresAt.getTime() <= now.getTime();
  }

  private async isMemberOf(
    store: MembershipRepository,
    tenantId: string,
    email: string,
  ): Promise<boolean> {
    const members = await store.listByTenant(tenantId);
    return members.some((member) => member.user.email === email);
  }

  /**
   * Lee el tenant **dentro** del scope transaccional.
   *
   * Que reciba el `TransactionScope` y no use `this.tenants` no es un detalle de
   * estilo: el `plan` decide si `maxUsers` bloquea, y leerlo por fuera de la
   * transacción haría que un cambio concurrente del plan se aplicara o se ignorara
   * según el orden de los locks. Además deja de hacer falta inyectar
   * `TENANT_REPOSITORY` para dos lecturas.
   */
  private async requireTenant(
    tenantId: string,
    scope: TransactionScope,
  ): Promise<TenantRecord> {
    const tenant = await scope.tenants.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError("not_found", "Tenant no encontrado");
    }
    return tenant;
  }
}
