import type {
  CreateMembershipInput,
  CreatePasswordResetTokenInput,
  CreateRefreshTokenInput,
  CreateTenantInput,
  CreateUserInput,
  CreateVerificationTokenInput,
  InvitationRecord,
  MembershipRecord,
  PasswordResetTokenRecord,
  PrincipalMembership,
  RefreshTokenRecord,
  TenantRecord,
  UserRecord,
  VerificationTokenRecord,
} from "../../domain/identity/entities";
import type {
  CreateInvitationInput,
  InvitationRepository,
} from "../../domain/ports/invitation-repository";
import type { MembershipRepository } from "../../domain/ports/membership-repository";
import type { PasswordResetTokenRepository } from "../../domain/ports/password-reset-token-repository";
import type { RefreshTokenRepository } from "../../domain/ports/refresh-token-repository";
import type { TenantRepository } from "../../domain/ports/tenant-repository";
import type { TransactionScope, UnitOfWork } from "../../domain/ports/unit-of-work";
import type { UserRepository } from "../../domain/ports/user-repository";
import type { VerificationTokenRepository } from "../../domain/ports/verification-token-repository";

/**
 * Dobles en memoria para las pruebas unitarias.
 *
 * Implementan el **puerto**, no las clases de Prisma: los tests de aplicación
 * no dependen de Infrastructure, y cualquier desviación entre puerto y
 * adaptador se detecta aquí (este archivo no compila si le falta un método).
 * Las aserciones sobre SQL, índices o constraints reales viven en los tests de
 * integración, donde sí hay PostgreSQL.
 *
 * Reproducen a propósito dos comportamientos del adaptador real que la
 * aplicación depende:
 *  - `listByUser`/`findPrincipalMembership` hidratan `tenant`;
 *  - `create` de usuario y membresía lanza el código `P2002` en caso de
 *    violación de unicidad.
 */

const FIXED_DATE = new Date("2026-09-29T00:00:00.000Z");

function uniqueError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = "P2002";
  return error;
}

export class InMemoryUserRepository implements UserRepository {
  readonly rows: UserRecord[] = [];
  /** Error que debe lanzar el próximo `create` (carrera de email duplicado). */
  createError: Error | null = null;

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.rows.find((row) => row.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    if (this.createError) {
      const error = this.createError;
      this.createError = null;
      throw error;
    }
    if (this.rows.some((row) => row.email === input.email)) {
      throw uniqueError("Unique constraint failed on users.email");
    }
    const row = makeUser({
      ...(input.id ? { id: input.id } : {}),
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      status: input.status ?? "ACTIVE",
    });
    this.rows.push(row);
    return row;
  }

  async markEmailVerified(userId: string, at: Date): Promise<UserRecord> {
    const row = this.rows.find((candidate) => candidate.id === userId);
    if (!row) {
      throw new Error("usuario no encontrado");
    }
    row.emailVerifiedAt = at;
    return row;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<UserRecord> {
    const row = this.rows.find((candidate) => candidate.id === userId);
    if (!row) {
      throw new Error("usuario no encontrado");
    }
    row.passwordHash = passwordHash;
    return row;
  }
}

export class InMemoryTenantRepository implements TenantRepository {
  readonly rows: TenantRecord[] = [];

  async findById(id: string): Promise<TenantRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.rows.find((row) => row.slug === slug) ?? null;
  }

  async slugExists(slug: string): Promise<boolean> {
    return this.rows.some((row) => row.slug === slug);
  }

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    if (this.rows.some((row) => row.slug === input.slug)) {
      throw uniqueError("Unique constraint failed on tenants.slug");
    }
    const row = makeTenant({
      ...(input.id ? { id: input.id } : {}),
      slug: input.slug,
      name: input.name,
      plan: input.plan ?? "BASIC",
    });
    this.rows.push(row);
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<TenantRecord, "name" | "slug">>,
  ): Promise<TenantRecord> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error("tenant no encontrado");
    }
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly rows: MembershipRecord[] = [];

  constructor(private readonly tenants?: InMemoryTenantRepository) {}

  private hydrate(row: MembershipRecord): PrincipalMembership {
    const tenant =
      this.tenants?.rows.find((candidate) => candidate.id === row.tenantId) ??
      makeTenant({ id: row.tenantId });
    return { ...row, tenant };
  }

  async findByTenantAndUser(
    tenantId: string,
    userId: string,
  ): Promise<MembershipRecord | null> {
    return (
      this.rows.find(
        (row) => row.tenantId === tenantId && row.userId === userId,
      ) ?? null
    );
  }

  async findPrincipalMembership(
    tenantId: string,
    userId: string,
  ): Promise<PrincipalMembership | null> {
    const row = await this.findByTenantAndUser(tenantId, userId);
    return row ? this.hydrate(row) : null;
  }

  async listByUser(userId: string): Promise<PrincipalMembership[]> {
    return this.rows
      .filter((row) => row.userId === userId)
      .map((row) => this.hydrate(row));
  }

  async listByTenant(tenantId: string) {
    return this.rows
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({
        ...row,
        user: {
          id: row.userId,
          email: `${row.userId}@example.com`,
          name: row.userId,
          status: "ACTIVE",
          emailVerifiedAt: null,
          createdAt: FIXED_DATE,
        },
      }));
  }

  async countActiveByTenant(tenantId: string): Promise<number> {
    return this.rows.filter(
      (row) => row.tenantId === tenantId && row.status === "ACTIVE",
    ).length;
  }

  async countActiveOwners(tenantId: string): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.role === "OWNER" &&
        row.status === "ACTIVE",
    ).length;
  }

  /** No-op: los dobles no comparten filas entre transacciones. */
  async lockActiveOwners(_tenantId: string): Promise<void> {
    return undefined;
  }

  async create(input: CreateMembershipInput): Promise<MembershipRecord> {
    if (await this.findByTenantAndUser(input.tenantId, input.userId)) {
      throw uniqueError("Unique constraint failed on memberships");
    }
    const row = makeMembership({
      ...(input.id ? { id: input.id } : {}),
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: input.status ?? "ACTIVE",
    });
    this.rows.push(row);
    return row;
  }

  async updateStatus(id: string, status: string): Promise<MembershipRecord> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error("membresía no encontrada");
    }
    row.status = status;
    return row;
  }

  async updateRole(id: string, role: string): Promise<MembershipRecord> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error("membresía no encontrada");
    }
    row.role = role;
    return row;
  }
}

export class InMemoryRefreshTokenRepository
  implements RefreshTokenRepository
{
  readonly rows: RefreshTokenRecord[] = [];

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    if (this.rows.some((row) => row.tokenHash === input.tokenHash)) {
      throw uniqueError("Unique constraint failed on refresh_tokens.token_hash");
    }
    const row: RefreshTokenRecord = {
      id: input.id ?? `rt-${this.rows.length + 1}`,
      userId: input.userId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedById: null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: FIXED_DATE,
    };
    this.rows.push(row);
    return row;
  }

  async revokeIfActive(
    id: string,
    revokedAt: Date,
    replacedById?: string,
  ): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.revokedAt !== null) {
      return false;
    }
    row.revokedAt = revokedAt;
    row.replacedById = replacedById ?? null;
    return true;
  }

  async revokeFamily(sessionId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.sessionId === sessionId && row.revokedAt === null) {
        row.revokedAt = revokedAt;
        count += 1;
      }
    }
    return count;
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.revokedAt === null) {
        row.revokedAt = revokedAt;
        count += 1;
      }
    }
    return count;
  }

  async listActiveByUser(userId: string): Promise<RefreshTokenRecord[]> {
    return this.rows.filter(
      (row) => row.userId === userId && row.revokedAt === null,
    );
  }

  async countActiveByUser(userId: string): Promise<number> {
    return (await this.listActiveByUser(userId)).length;
  }
}

export class InMemoryVerificationTokenRepository
  implements VerificationTokenRepository
{
  readonly rows: VerificationTokenRecord[] = [];

  async findByTokenHash(
    tokenHash: string,
  ): Promise<VerificationTokenRecord | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async create(
    input: CreateVerificationTokenInput,
  ): Promise<VerificationTokenRecord> {
    const row: VerificationTokenRecord = {
      id: input.id ?? `vt-${this.rows.length + 1}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: FIXED_DATE,
    };
    this.rows.push(row);
    return row;
  }

  async markUsed(id: string, usedAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.usedAt !== null) {
      return false;
    }
    row.usedAt = usedAt;
    return true;
  }

  async invalidatePendingByUser(userId: string, at: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.usedAt === null) {
        row.usedAt = at;
        count += 1;
      }
    }
    return count;
  }
}

export class InMemoryPasswordResetTokenRepository
  implements PasswordResetTokenRepository
{
  readonly rows: PasswordResetTokenRecord[] = [];

  async findByTokenHash(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async create(
    input: CreatePasswordResetTokenInput,
  ): Promise<PasswordResetTokenRecord> {
    const row: PasswordResetTokenRecord = {
      id: input.id ?? `prt-${this.rows.length + 1}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: FIXED_DATE,
    };
    this.rows.push(row);
    return row;
  }

  async markUsed(id: string, usedAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.usedAt !== null) {
      return false;
    }
    row.usedAt = usedAt;
    return true;
  }

  async invalidatePendingByUser(userId: string, at: Date): Promise<number> {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.usedAt === null) {
        row.usedAt = at;
        count += 1;
      }
    }
    return count;
  }
}

/**
 * Invitaciones en memoria.
 *
 * Reproduce la restricción del índice parcial `(tenant_id, email) WHERE
 * status='PENDING'` lanzando el mismo código `P2002` que Prisma, en vez de
 * dejarla que el caso de uso lo detecte con un `find` previo. El doble es
 * deliberadamente *más estricto* que un `find` + create: si la aplicación
 * dependiera del `find`, el test pasaría con el doble y fallaría en producción
 * bajo dos invitaciones concurrentes.
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  readonly rows: InvitationRecord[] = [];

  async findById(id: string): Promise<InvitationRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<InvitationRecord | null> {
    return this.rows.find((row) => row.tokenHash === tokenHash) ?? null;
  }

  async findPendingByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<InvitationRecord | null> {
    return (
      this.rows.find(
        (row) =>
          row.tenantId === tenantId &&
          row.email === email &&
          row.status === "PENDING",
      ) ?? null
    );
  }

  async listExpiredPending(
    tenantId: string,
    now: Date,
  ): Promise<InvitationRecord[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.status === "PENDING" &&
        row.expiresAt.getTime() <= now.getTime(),
    );
  }

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    const pending = await this.findPendingByTenantAndEmail(
      input.tenantId,
      input.email,
    );
    if (pending) {
      throw uniqueError(
        "violates unique constraint invitations_tenant_id_email_pending_key",
      );
    }

    const row: InvitationRecord = {
      id: input.id ?? `inv-${this.rows.length + 1}`,
      tenantId: input.tenantId,
      email: input.email,
      role: input.role,
      invitedBy: input.invitedBy,
      tokenHash: input.tokenHash,
      status: "PENDING",
      expiresAt: input.expiresAt,
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      createdAt: FIXED_DATE,
    };
    this.rows.push(row);
    return row;
  }

  async consume(
    id: string,
    accepted: { acceptedAt: Date; acceptedBy: string },
  ): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== "PENDING") {
      return false;
    }
    row.status = "ACCEPTED";
    row.acceptedAt = accepted.acceptedAt;
    row.acceptedBy = accepted.acceptedBy;
    return true;
  }

  async revoke(id: string, revokedAt: Date): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== "PENDING") {
      return false;
    }
    row.status = "REVOKED";
    row.revokedAt = revokedAt;
    return true;
  }

  async markExpired(id: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.status !== "PENDING") {
      return false;
    }
    row.status = "EXPIRED";
    return true;
  }
}

/**
 * Unit of work sin transacciones reales.
 *
 * Un repositorio en memoria no puede deshacer escrituras parciales, así que
 * el "rollback" se simula con una instantánea: si la transacción lanza, el
 * contenido de los arrays vivos se restaura. Es lo que permite afirmar en un
 * test unitario que un fallo a mitad del registro **no** deja usuario huérfano
 * — un comportamiento que en producción da la transacción real.
 *
 * La instantánea copia cada fila (`{...row}`) en lugar de guardar la
 * referencia: sin la copia, restaurar devolvería los mismos objetos ya
 * mutados y el rollback no deshacería nada.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(private readonly scope: InMemoryScope) {}

  async transaction<T>(
    fn: (scope: TransactionScope) => Promise<T>,
  ): Promise<T> {
    const snapshot = snapshotScope(this.scope);
    try {
      return await fn(this.scope);
    } catch (error) {
      restoreScope(this.scope, snapshot);
      throw error;
    }
  }
}

interface ScopeSnapshot {
  users: UserRecord[];
  tenants: TenantRecord[];
  memberships: MembershipRecord[];
  refreshTokens: RefreshTokenRecord[];
  verificationTokens: VerificationTokenRecord[];
  passwordResetTokens: PasswordResetTokenRecord[];
  invitations: InvitationRecord[];
}

function snapshotScope(scope: InMemoryScope): ScopeSnapshot {
  return {
    users: cloneRows(scope.users.rows),
    tenants: cloneRows(scope.tenants.rows),
    memberships: cloneRows(scope.memberships.rows),
    refreshTokens: cloneRows(scope.refreshTokens.rows),
    verificationTokens: cloneRows(scope.verificationTokens.rows),
    passwordResetTokens: cloneRows(scope.passwordResetTokens.rows),
    invitations: cloneRows(scope.invitations.rows),
  };
}

function restoreScope(scope: InMemoryScope, snapshot: ScopeSnapshot): void {
  replaceAll(scope.users.rows, snapshot.users);
  replaceAll(scope.tenants.rows, snapshot.tenants);
  replaceAll(scope.memberships.rows, snapshot.memberships);
  replaceAll(scope.refreshTokens.rows, snapshot.refreshTokens);
  replaceAll(scope.verificationTokens.rows, snapshot.verificationTokens);
  replaceAll(scope.passwordResetTokens.rows, snapshot.passwordResetTokens);
  replaceAll(scope.invitations.rows, snapshot.invitations);
}

function cloneRows<T extends object>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/**
 * Sustituye el contenido **en la misma referencia de array**.
 *
 * Los repositorios y el `UnitOfWork` comparten la referencia del array, así
 * que reasignar (`rows = ...`) no revertiría nada.
 */
function replaceAll<T>(target: T[], source: T[]): void {
  target.length = 0;
  for (const row of source) {
    target.push(row);
  }
}

/**
 * Alcance transaccional con los dobles concretos a la vista.
 *
 * La firma pública sigue siendo `TransactionScope` (el puerto); el tipo
 * concreto solo se usa aquí, dentro de los tests, donde hace falta poder
 * inspeccionar e mutar `rows` para simular cambios de estado.
 */
export type InMemoryScope = TransactionScope & {
  users: InMemoryUserRepository;
  tenants: InMemoryTenantRepository;
  memberships: InMemoryMembershipRepository;
  refreshTokens: InMemoryRefreshTokenRepository;
  verificationTokens: InMemoryVerificationTokenRepository;
  passwordResetTokens: InMemoryPasswordResetTokenRepository;
  invitations: InMemoryInvitationRepository;
};

export function createInMemoryScope(): InMemoryScope {
  const tenants = new InMemoryTenantRepository();
  return {
    users: new InMemoryUserRepository(),
    tenants,
    memberships: new InMemoryMembershipRepository(tenants),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    verificationTokens: new InMemoryVerificationTokenRepository(),
    passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
    invitations: new InMemoryInvitationRepository(),
  };
}

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    email: "ana@example.com",
    name: "Ana Torres",
    status: "ACTIVE",
    passwordHash: "hash",
    emailVerifiedAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: "tenant-1",
    slug: "ana-torres",
    name: "Ana Torres",
    plan: "BASIC",
    status: "ACTIVE",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeInvitation(
  overrides: Partial<InvitationRecord> = {},
): InvitationRecord {
  return {
    id: "inv-1",
    tenantId: "tenant-1",
    email: "invitado@example.com",
    role: "AGENT",
    invitedBy: "user-1",
    tokenHash: "hash-invitacion",
    status: "PENDING",
    expiresAt: new Date("2026-09-30T00:00:00.000Z"),
    acceptedAt: null,
    acceptedBy: null,
    revokedAt: null,
    createdAt: FIXED_DATE,
    ...overrides,
  };
}

export function makeMembership(
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    id: "membership-1",
    tenantId: "tenant-1",
    userId: "user-1",
    role: "OWNER",
    status: "ACTIVE",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  };
}
