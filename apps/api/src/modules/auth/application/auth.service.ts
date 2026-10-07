import { Inject, Injectable } from "@nestjs/common";
import {
  ID_GENERATOR,
  OPAQUE_TOKEN_GENERATOR,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  TOKEN_HASHER,
  UNIT_OF_WORK,
  USER_REPOSITORY,
} from "../../../common/di-tokens";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InvalidTokenError,
  NotFoundError,
} from "../../../domain/errors";
import type {
  MembershipRecord,
  TenantRecord,
  UserRecord,
} from "../../../domain/identity/entities";
import {
  assertPasswordPolicy,
  ensureUniqueSlug,
  normalizeEmail,
  slugify,
} from "../../../domain/identity";
import type {
  IdGenerator,
  OpaqueTokenGenerator,
  PasswordHasher,
  RefreshTokenRepository,
  TokenHasher,
  UnitOfWork,
  UserRepository,
} from "../../../domain/ports";
import { classifyRefreshLookup } from "../../../domain/session/refresh-session";
import { AuthConfigService } from "./auth-config.service";
import { EmailVerificationSender } from "./email-verification-sender";
import { PasswordResetSender } from "./password-reset-sender";
import type { RequestMetadata } from "./request-metadata";
import { StructuredLogger } from "../../../common/logger/structured-logger";
import {
  RefreshAlreadyRotatedError,
  SessionService,
} from "./session.service";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
  user: UserRecord;
  tenant: TenantRecord;
  membership: MembershipRecord;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface MembershipSummary {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: string;
  status: string;
}

export interface AuthMe {
  user: UserRecord;
  currentTenant: TenantRecord;
  membership: MembershipRecord;
  memberships: MembershipSummary[];
}

@Injectable()
export class AuthService {
  private readonly logger = StructuredLogger.fromEnv();

  /**
   * Hash señuelo para igualar tiempos de respuesta.
   *
   * Sin él, un login con email inexistente responde en ~1 ms (un SELECT) y uno
   * con email existente en ~50 ms (Argon2id). Esa diferencia es un oráculo de
   * enumeración de cuentas aunque el mensaje de error sea idéntico. Se genera
   * una vez por proceso y se reutiliza.
   */
  private decoyHash: string | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshTokenStore: RefreshTokenRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(OPAQUE_TOKEN_GENERATOR)
    private readonly opaqueTokens: OpaqueTokenGenerator,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    private readonly verificationSender: EmailVerificationSender,
    private readonly resetSender: PasswordResetSender,
    private readonly sessions: SessionService,
    private readonly config: AuthConfigService,
  ) {}

  /**
   * Alta de cuenta + tenant + membresía OWNER + sesión inicial
   * (docs/architecture/authentication.md §8).
   *
   * User, tenant y membership van en una transacción: un registro fallido a
   * mitad dejaría un usuario sin tenant o un tenant sin dueño, y ninguno de
   * los dos estados es reparable desde la API.
   *
   * El hash de la contraseña se calcula **fuera** de la transacción
   * (~50 ms de CPU) para no retener bloqueos de fila durante el Argon2id.
   */
  async register(
    input: { name: string; email: string; password: string },
    meta: RequestMetadata = {},
  ): Promise<AuthSession> {
    assertPasswordPolicy(input.password);

    const email = normalizeEmail(input.email);
    const name = input.name.trim();

    if (await this.users.findByEmail(email)) {
      throw new ConflictError(
        "email_already_registered",
        "El correo ya está registrado",
      );
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    // La carrera entre dos registros simultáneos con el mismo email se
    // resuelve en la constraint UNIQUE: el repositorio traduce P2002 a 409.
    const created = await this.unitOfWork.transaction(async (tx) => {
      const slug = await ensureUniqueSlug(slugify(name), (candidate) =>
        tx.tenants.slugExists(candidate),
      );

      const user = await tx.users.create({ email, passwordHash, name });
      const tenant = await tx.tenants.create({
        slug,
        name,
        plan: "BASIC",
      });
      const membership = await tx.memberships.create({
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER",
        status: "ACTIVE",
      });

      return { user, tenant, membership };
    });

    const session = await this.sessions.issue({
      userId: created.user.id,
      tenantId: created.tenant.id,
      meta,
    });

    // El email de verificación no puede tumbar el registro: si el proveedor
    // falla, la cuenta ya existe y el usuario puede pedir el reenvío (M-5).
    await this.sendVerificationEmail(created.user, created.tenant).catch(
      (error) => {
        this.logger.warn(
          "Verificación email falló durante registro",
          "AuthService",
          {
            userId: created.user.id,
            email: created.user.email,
            error: String(error),
          },
        );
      },
    );

    return { ...session, ...created };
  }

  async login(
    input: { email: string; password: string },
    meta: RequestMetadata = {},
  ): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);

    if (!user) {
      await this.equalizeTiming(input.password);
      throw this.invalidCredentials();
    }

    if (!(await this.passwordHasher.verify(input.password, user.passwordHash))) {
      // Mismo código y mensaje que el email inexistente: no se distingue
      // "no existe" de "contraseña incorrecta" (authentication.md §10).
      throw this.invalidCredentials();
    }

    if (user.status !== "ACTIVE") {
      throw new AuthorizationError(
        "account_disabled",
        "La cuenta está deshabilitada",
      );
    }

    const memberships = await this.activeMemberships(user.id);
    const selected = memberships[0];
    if (!selected) {
      throw new AuthorizationError(
        "membership_inactive",
        "El usuario no tiene ninguna membresía activa",
      );
    }

    const session = await this.sessions.issue({
      userId: user.id,
      tenantId: selected.tenant.id,
      meta,
    });

    return {
      ...session,
      user,
      tenant: selected.tenant,
      membership: selected,
    };
  }

  /**
   * Rotación con detección de reuse (docs/architecture/authentication.md §5).
   *
   * `classifyRefreshLookup` (regla pura de M-3) decide la intención; este
   * método se limita a ejecutarla contra PostgreSQL.
   */
  async refresh(
    input: { refreshToken: string },
    meta: RequestMetadata = {},
  ): Promise<AuthTokenPair> {
    const now = this.config.now();
    const tokenHash = this.tokenHasher.hashToken(input.refreshToken);
    const existing = await this.refreshTokenStore.findByTokenHash(tokenHash);

    const intent = classifyRefreshLookup(
      {
        status: existing ? "found" : "not_found",
        ...(existing
          ? {
              revokedAt: existing.revokedAt,
              // `revokeIfActive` fija `revoked_at` y `replaced_by_token_id` en
              // el mismo UPDATE, así que un token rotado siempre aparece como
              // revocado. `replacedById` se sigue propagando para que la regla
              // pura cubra también el caso inconsistente.
              replacedAt: existing.replacedById ? existing.revokedAt : null,
              expiresAt: existing.expiresAt,
            }
          : {}),
      },
      now,
    );

    if (intent.kind === "invalid") {
      // Token desconocido o expirado: 401 limpio y **sin** revocar la familia.
      // Un token caducado no es indicio de robo, y revocarla cortaría sesiones
      // legítimas en curso (authentication.md §5, paso 3).
      throw new AuthenticationError(
        "invalid_refresh_token",
        "Refresh token inválido o expirado",
      );
    }

    if (!existing) {
      // Salvaguarda: `classifyRefreshLookup` solo devuelve `rotate` con
      // `status = "found"`.
      throw new AuthenticationError(
        "invalid_refresh_token",
        "Refresh token inválido o expirado",
      );
    }

    if (intent.kind === "reuse_attack") {
      // Un token ya rotado que vuelve a presentarse significa que alguien
      // tiene una copia: se termina la familia completa (authentication.md §5).
      await this.sessions.revokeFamily(existing.sessionId, now);
      throw new AuthenticationError(
        "reuse_detected",
        "Refresh token reutilizado; sesión revocada",
      );
    }

    const user = await this.users.findById(existing.userId);
    if (!user) {
      throw new AuthenticationError(
        "invalid_refresh_token",
        "Refresh token inválido o expirado",
      );
    }
    if (user.status !== "ACTIVE") {
      throw new AuthorizationError(
        "account_disabled",
        "La cuenta está deshabilitada",
      );
    }

    try {
      return await this.sessions.rotate({
        current: existing,
        userId: user.id,
        meta,
        now,
      });
    } catch (error) {
      if (error instanceof RefreshAlreadyRotatedError) {
        // Carrera de rotación: otro request ganó entre nuestra lectura y el
        // UPDATE condicional. Se trata igual que un reuse y se revoca la
        // familia, porque no podemos distinguir "ataque" de "doble clic".
        await this.sessions.revokeFamily(existing.sessionId, now);
        throw new AuthenticationError(
          "reuse_detected",
          "Refresh token reutilizado; sesión revocada",
        );
      }
      throw error;
    }
  }

  /**
   * Logout: revoca la familia de la sesión actual.
   *
   * El `sessionId` viene del `jti` del access token, no del body: si el único
   * identificador fuese el refresh token del cuerpo, un access token robado no
   * bastaría para cerrar la sesión, que es justo el escenario que la rotación
   * de refresh tokens intenta cerrar.
   */
  async logout(sessionId: string): Promise<number> {
    return this.sessions.revokeFamily(sessionId, this.config.now());
  }

  /** Cierre de seguridad: revoca todas las sesiones del usuario. */
  async revokeAll(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId, this.config.now());
  }

  /**
   * Solicitud de recuperación de contraseña (authentication.md §9).
   *
   * Respuesta **uniforme**: no distingue email inexistente, cuenta deshabilitada
   * o envío realizado, para que el endpoint no sea un oráculo de cuentas
   * registradas. Con cuenta válida se emite el token de 1-uso (15 min) y se
   * invalida cualquier reset pendiente anterior.
   */
  async forgotPassword(input: { email: string }): Promise<void> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== "ACTIVE") {
      return;
    }
    await this.resetSender.send({
      id: user.id,
      email: user.email,
      name: user.name,
    });
  }

  /**
   * Consumo del token de reset y cambio de contraseña (authentication.md §9).
   *
   * El consumo (1-uso) y el cambio de password van en la misma transacción:
   * aplicar el hash sin consumir el token lo dejaría reutilizable, y consumirlo
   * sin cambiar nada sería el peor rompecabezas. Después, fuera de la tx, se
   * revocan **todas** las sesiones: la contraseña cambió y las sesiones viejas
   * no deben sobrevivir sin reautenticar.
   *
   * El Argon2id se calcula antes de la transacción, igual que en `register`:
   * ~50 ms de CPU no deben retener bloqueos de fila.
   */
  async resetPassword(input: {
    token: string;
    newPassword: string;
  }): Promise<void> {
    assertPasswordPolicy(input.newPassword);

    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const tokenHash = this.tokenHasher.hashToken(input.token);
    const now = this.config.now();

    const outcome = await this.unitOfWork.transaction(async (tx) => {
      const record = await tx.passwordResetTokens.findByTokenHash(tokenHash);

      // Un solo código para inválido / usado / vencido (mismo principio que la
      // verificación de email): distinguirlos convertiría el endpoint en un
      // oráculo que confirma si un token está vivo.
      if (!record || record.usedAt !== null) {
        throw new InvalidTokenError();
      }

      if (record.expiresAt.getTime() <= now.getTime()) {
        // Consumir y confirmar, lanzando el error fuera de la transacción: un
        // `throw` aquí haría rollback y el token vencido seguiría vivo.
        await tx.passwordResetTokens.markUsed(record.id, now);
        return { kind: "expired" as const, userId: record.userId };
      }

      if (!(await tx.passwordResetTokens.markUsed(record.id, now))) {
        // Carrera: otra petición consumió el token entre lectura y uso.
        throw new InvalidTokenError();
      }

      await tx.users.updatePassword(record.userId, passwordHash);
      // Defensa extra: cualquier otro reset pendiente queda sin sentido.
      await tx.passwordResetTokens.invalidatePendingByUser(record.userId, now);

      return { kind: "ok" as const, userId: record.userId };
    });

    if (outcome.kind === "expired") {
      throw new InvalidTokenError();
    }

    await this.sessions.revokeAllForUser(outcome.userId, now);
  }

  /**
   * Cambio del tenant activo de la sesión (authentication.md §8).
   *
   * Emite una **familia nueva** en lugar de reutilizar la actual: el `jti` es
   * el ancla de la familia, y un mismo `jti` sirviendo a dos tenants haría que
   * un logout cerrara sesiones de dos empresas a la vez.
   */
  async switchTenant(
    userId: string,
    tenantId: string,
    meta: RequestMetadata = {},
  ): Promise<AuthSession> {
    const resolved = await this.unitOfWork.transaction(async (tx) => {
      const tenant = await tx.tenants.findById(tenantId);
      if (!tenant) {
        // Mismo error que "no eres miembro": no se revela la existencia de
        // tenants ajenos.
        throw new AuthorizationError(
          "membership_inactive",
          "No tienes una membresía activa en ese tenant",
        );
      }

      const membership = await tx.memberships.findByTenantAndUser(
        tenantId,
        userId,
      );
      if (!membership || membership.status !== "ACTIVE") {
        throw new AuthorizationError(
          "membership_inactive",
          "No tienes una membresía activa en ese tenant",
        );
      }

      if (tenant.status !== "ACTIVE") {
        throw new AuthorizationError(
          "tenant_inactive",
          "El tenant no está activo",
        );
      }

      const user = await tx.users.findById(userId);
      if (!user) {
        throw new NotFoundError("user_not_found", "Usuario no encontrado");
      }
      if (user.status !== "ACTIVE") {
        throw new AuthorizationError(
          "account_disabled",
          "La cuenta está deshabilitada",
        );
      }

      return { user, tenant, membership };
    });

    const session = await this.sessions.issue({
      userId: resolved.user.id,
      tenantId: resolved.tenant.id,
      meta,
    });

    return { ...session, ...resolved };
  }

  /** `GET /v1/me`: principal del request y todas sus membresías. */
  async me(userId: string, tenantId: string): Promise<AuthMe> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError("user_not_found", "Usuario no encontrado");
    }

    const memberships = await this.activeMemberships(userId);
    const current = memberships.find((m) => m.tenantId === tenantId);

    if (!current) {
      // El guard ya validó la membresía; si no aparece aquí es que cambió
      // entre guard y servicio (degradación de membresía concurrente).
      throw new AuthorizationError(
        "membership_inactive",
        "Membresía no encontrada",
      );
    }

    const all = await this.allMemberships(userId);

    return {
      user,
      currentTenant: current.tenant,
      membership: current,
      memberships: all.map((m) => ({
        tenantId: m.tenantId,
        tenantSlug: m.tenant.slug,
        tenantName: m.tenant.name,
        role: m.role,
        status: m.status,
      })),
    };
  }

  private async allMemberships(userId: string) {
    return this.unitOfWork.transaction((tx) =>
      tx.memberships.listByUser(userId),
    );
  }

  /**
   * Membresías usables: la relación `ACTIVE` **y** el tenant `ACTIVE`.
   *
   * Filtrar por ambos en el mismo paso evita emitir un access token que el
   * `TenantContextGuard` va a rechazar con 403 en el request siguiente.
   */
  private async activeMemberships(userId: string) {
    const all = await this.allMemberships(userId);
    return all.filter(
      (m) => m.status === "ACTIVE" && m.tenant.status === "ACTIVE",
    );
  }

  private invalidCredentials(): AuthenticationError {
    return new AuthenticationError("invalid_credentials", "Credenciales inválidas");
  }

  private async equalizeTiming(password: string): Promise<void> {
    this.decoyHash ??= await this.passwordHasher.hash(this.ids.next());
    await this.passwordHasher.verify(password, this.decoyHash);
  }

  /**
   * Token de verificación de email de un solo uso (authentication.md §8).
   *
   * Delegado en `EmailVerificationSender`: la lógica (TTL, hasheado, envío) la
   * necesita también `POST /v1/email-verification/resend`, y mantenerla aquí
   * como método privado obligaba a duplicarla en cuanto ese endpoint apareció.
   */
  private async sendVerificationEmail(
    user: UserRecord,
    tenant: TenantRecord,
  ): Promise<void> {
    await this.verificationSender.send(user, tenant.name);
  }
}
