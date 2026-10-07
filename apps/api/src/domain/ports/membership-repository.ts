import type {
  CreateMembershipInput,
  MembershipRecord,
  PrincipalMembership,
} from "../identity/entities";

/**
 * Puerto de acceso a `memberships` (tabla **tenant-scoped**).
 *
 * Es la fuente de verdad de la autorización (ADR-005): el rol y el estado de
 * la relación usuario↔tenant se releen de aquí en cada request, nunca del JWT.
 */
export interface MembershipRepository {
  findByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<MembershipRecord | null>;

  /**
   * Membership + tenant para el guard. Devuelve `null` si la relación no
   * existe; el guard decide si es 401 o 403 según el motivo.
   */
  findPrincipalMembership(
    tenantId: string,
    userId: string,
  ): Promise<PrincipalMembership | null>;

  /** Membresías del usuario en todos sus tenants (para `/me` y switch-tenant). */
  listByUser(userId: string): Promise<PrincipalMembership[]>;

  /** Miembros del tenant con su usuario (Fase 5, ya definido desde aquí). */
  listByTenant(
    tenantId: string,
  ): Promise<
    Array<
      MembershipRecord & {
        user: {
          id: string;
          email: string;
          name: string;
          status: string;
          emailVerifiedAt: Date | null;
          createdAt: Date;
        };
      }
    >
  >;

  /** Miembros activos del tenant: insumo de `LimitsService.assertUnderLimit`. */
  countActiveByTenant(tenantId: string): Promise<number>;

  /**
   * OWNERs activos del tenant.
   *
   * Es el insumo de la invariante "no puede quedar el tenant sin dueño": se
   * consulta dentro de la misma transacción que degrada, para que el conteo y
   * la escritura no observen estados intermedios distintos.
   */
  countActiveOwners(tenantId: string): Promise<number>;

  /**
   * Bloquea las filas de los OWNER activos del tenant para la transacción
   * actual (`SELECT … FOR UPDATE`).
   *
   * Cierra la carrera de dos OWNER que se degradan mútuamente a la vez: sin
   * el lock, ambos transacciones leen `count = 2`, los dos escriben y el
   * tenant se queda con 0 dueños. Con el lock, el segundo espera al commit del
   * primero y su re-conteo (statement nuevo, READ COMMITTED) ya ve 1 → 409.
   *
   * Los dobles en memoria la implementan como no-op: no hay filas que
   * contendan entre transacciones con las que compartir estado.
   */
  lockActiveOwners(tenantId: string): Promise<void>;

  create(input: CreateMembershipInput): Promise<MembershipRecord>;

  updateStatus(
    id: string,
    status: string,
  ): Promise<MembershipRecord>;

  updateRole(id: string, role: string): Promise<MembershipRecord>;
}
