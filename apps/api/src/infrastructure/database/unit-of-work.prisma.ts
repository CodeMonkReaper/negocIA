import { Injectable } from "@nestjs/common";
import type {
  TransactionScope,
  UnitOfWork,
} from "../../domain/ports/unit-of-work";
import { PrismaInvitationRepository } from "./repositories/prisma-invitation.repository";
import { PrismaMembershipRepository } from "./repositories/prisma-membership.repository";
import { PrismaPasswordResetTokenRepository } from "./repositories/prisma-password-reset-token.repository";
import { PrismaRefreshTokenRepository } from "./repositories/prisma-refresh-token.repository";
import { PrismaTenantRepository } from "./repositories/prisma-tenant.repository";
import {
  type Db,
  PrismaUserRepository,
} from "./repositories/prisma-user.repository";
import { PrismaVerificationTokenRepository } from "./repositories/prisma-verification-token.repository";
import { PrismaService } from "./prisma.service";

/**
 * Unit of work sobre `$transaction` de Prisma.
 *
 * Los repositorios se **reconstruyen** con el cliente transaccional en vez de
 * reutilizar los singletons: así es imposible que un método mezcle la mitad de
 * sus queries dentro de la transacción y la mitad fuera.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async transaction<T>(fn: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.prisma.db.$transaction(async (tx) => fn(buildScope(tx)));
  }
}

export function buildScope(db: Db): TransactionScope {
  return {
    users: new PrismaUserRepository(db),
    tenants: new PrismaTenantRepository(db),
    memberships: new PrismaMembershipRepository(db),
    refreshTokens: new PrismaRefreshTokenRepository(db),
    verificationTokens: new PrismaVerificationTokenRepository(db),
    passwordResetTokens: new PrismaPasswordResetTokenRepository(db),
    invitations: new PrismaInvitationRepository(db),
  };
}
