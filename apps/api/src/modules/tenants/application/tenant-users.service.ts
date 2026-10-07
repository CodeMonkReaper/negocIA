import { Inject, Injectable } from "@nestjs/common";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "../../../domain/errors";
import { type MembershipStatus } from "../../../domain/identity/statuses";
import { hasAtLeast, type Role } from "../../../domain/identity/roles";
import type { MembershipRepository, UnitOfWork } from "../../../domain/ports";
import { UNIT_OF_WORK } from "../../../common/di-tokens";

/** Estructura que devuelve el port `listByTenant` (membership + usuario). */
export type TenantUserRow = Awaited<
  ReturnType<MembershipRepository["listByTenant"]>
>[number];

export interface UpdateTenantUserCommand {
  /** Tenant de la URL; ya verificado contra el tenant activo por el controller. */
  tenantId: string;
  targetUserId: string;
  /** Actor: quien llama, con su rol ya resuelto desde BD por el guard. */
  actorUserId: string;
  actorRole: Role;
  role?: Role;
  /** Estado de la **membresía**, no del usuario. */
  status?: MembershipStatus;
}

export interface UpdateTenantUserResult {
  userId: string;
  role: Role;
  status: string;
}

type Change =
  | { kind: "role"; value: Role }
  | { kind: "status"; value: MembershipStatus }
  | { kind: "both"; role: Role; status: MembershipStatus };

/**
 * Los valores ya vienen validados por el DTO (`@IsIn`); este paso solo decide
 * **qué** se toca, y `null` para un `PATCH` con el cuerpo vacío.
 */
function toChange(command: UpdateTenantUserCommand): Change | null {
  const hasRole = command.role !== undefined;
  const hasStatus = command.status !== undefined;

  if (!hasRole && !hasStatus) {
    return null;
  }
  if (hasRole && hasStatus) {
    return { kind: "both", role: command.role as Role, status: command.status as MembershipStatus };
  }
  if (hasRole) {
    return { kind: "role", value: command.role as Role };
  }
  return { kind: "status", value: command.status as MembershipStatus };
}

/**
 * Gestión de usuarios de un tenant (docs/api/authentication.md §9).
 *
 * Las invariantes que hay que mantener y **por qué** no se pueden dejar al
 * `RolesGuard`:
 *
 *  - Un ADMIN no puede tocar a un OWNER. El guard solo sabe el rol del que
 *    llama; el rol del objetivo se lee aquí.
 *  - No se puede degradar al último OWNER activo. Esta es una invariante **del
 *    tenant**, no del que llama: dos OWNERs podrían degradarse mútuamente en
 *    paralelo y dejar el tenant sin dueños, así que la comprobación vive dentro
 *    de la misma transacción que la escritura, precedida de un lock de las
 *    filas OWNER (`lockActiveOwners`) que serializa los dos degradadores
 *    simultáneos.
 */
@Injectable()
export class TenantUsersService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
  ) {}

  async listUsers(tenantId: string): Promise<TenantUserRow[]> {
    return this.unitOfWork.transaction((tx) =>
      tx.memberships.listByTenant(tenantId),
    );
  }

  async updateUser(
    command: UpdateTenantUserCommand,
  ): Promise<UpdateTenantUserResult> {
    const change = toChange(command);
    if (!change) {
      throw new ConflictError("conflict", "No se indicó qué cambiar");
    }

    // La lectura del objetivo ocurre dentro de la transacción para que el rol
    // que se comprueba y el que se actualiza no se puedan intercalar.
    return this.unitOfWork.transaction(async (tx) => {
      const target = await tx.memberships.findByTenantAndUser(
        command.tenantId,
        command.targetUserId,
      );
      if (!target) {
        throw new NotFoundError(
          "user_not_found",
          "Usuario no encontrado en este tenant",
        );
      }

      // Un ADMIN gestiona solo a no-OWNER: el guard ya dejó pasar a
      // ADMIN/OWNER, pero el nivel lo dicta el objetivo, no el autor.
      if (!hasAtLeast(command.actorRole, "OWNER") && target.role === "OWNER") {
        throw new AuthorizationError(
          "forbidden",
          "No puedes gestionar al propietario del tenant",
        );
      }

      const nextRole: Role =
        change.kind === "role"
          ? change.value
          : change.kind === "both"
            ? change.role
            : (target.role as Role);
      const nextStatus: string =
        change.kind === "status"
          ? change.value
          : change.kind === "both"
            ? change.status
            : target.status;

      // Invariante del último OWNER. La degradación puede venir por el rol
      // (OWNER → ADMIN/AGENT) o por el estado (ACTIVE → INACTIVE), así que se
      // evalúa contra el resultado, no contra el campo tocado.
      const becomesNonOwner =
        target.role === "OWNER" &&
        (nextRole !== "OWNER" || nextStatus !== "ACTIVE");

      if (becomesNonOwner) {
        // El lock serie el acceso a las filas OWNER del tenant: dos
        // degradadores simultáneos se ejecutan uno detrás de otro, y el
        // segundo, al recontar en un statement nuevo, ve la degradación ya
        // commiteada del primero.
        await tx.memberships.lockActiveOwners(command.tenantId);
        const owners = await tx.memberships.countActiveOwners(
          command.tenantId,
        );
        if (owners <= 1) {
          throw new ConflictError(
            "conflict",
            "No puedes quedarte sin el último propietario del tenant",
            { owners },
          );
        }
      }

      if (change.kind === "role") {
        await tx.memberships.updateRole(target.id, change.value);
      }
      if (change.kind === "status") {
        await tx.memberships.updateStatus(target.id, change.value);
      }
      if (change.kind === "both") {
        await tx.memberships.updateRole(target.id, change.role);
        await tx.memberships.updateStatus(target.id, change.status);
      }

      return {
        userId: command.targetUserId,
        role: nextRole,
        status: nextStatus,
      };
    });
  }
}