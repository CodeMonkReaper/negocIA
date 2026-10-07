import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { CryptoService } from "@negocia/config";
import {
  DEPENDENCY_PROBE,
  DEPENDENCY_PROBES,
  CONVERSATION_REPOSITORY,
  INVITATION_REPOSITORY,
  LLM_RUN_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  PASSWORD_RESET_TOKEN_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  TENANT_REPOSITORY,
  UNIT_OF_WORK,
  USER_REPOSITORY,
  VERIFICATION_TOKEN_REPOSITORY,
  WHATSAPP_ACCOUNT_REPOSITORY,
  WHATSAPP_EVENT_REPOSITORY,
} from "../../common/di-tokens";
import { PrismaDependencyProbe } from "./prisma-dependency-probe";
import { PrismaConversationRepository } from "./repositories/prisma-conversation.repository";
import { PrismaInvitationRepository } from "./repositories/prisma-invitation.repository";
import { PrismaLlmRunRepository } from "./repositories/prisma-llm-run.repository";
import { PrismaMembershipRepository } from "./repositories/prisma-membership.repository";
import { PrismaPasswordResetTokenRepository } from "./repositories/prisma-password-reset-token.repository";
import { PrismaRefreshTokenRepository } from "./repositories/prisma-refresh-token.repository";
import { PrismaTenantRepository } from "./repositories/prisma-tenant.repository";
import { PrismaUserRepository } from "./repositories/prisma-user.repository";
import { PrismaVerificationTokenRepository } from "./repositories/prisma-verification-token.repository";
import { PrismaWhatsappAccountRepository } from "./repositories/prisma-whatsapp-account.repository";
import { PrismaWhatsappEventRepository } from "./repositories/prisma-whatsapp-event.repository";
import { PrismaService } from "./prisma.service";
import { PrismaUnitOfWork } from "./unit-of-work.prisma";
import { RedisDependencyProbe } from "../redis/redis-dependency-probe";

/**
 * Capa de persistencia.
 *
 * Es `@Global()` porque los repositorios se consumen desde módulos muy
 * distintos (auth en Fase 1; en Fase 2+ conversations, catálogo, agenda…) y no
 * tiene sentido reimportar `DatabaseModule` en cada uno.
 *
 * Doble registro, y por qué:
 *
 *  1. **Clase concreta** (`PrismaUserRepository`, …) para uso interno de
 *     Infrastructure y para tests que quieran el adaptador real.
 *  2. **Token de puerto** (`USER_REPOSITORY`, …) con `useExisting`, de modo que
 *     la aplicación resuelva por puerto y siga sin importar adaptadores
 *     (dependency-rules.md §2). `useExisting` y no `useFactory`: así ambos
 *     identificadores apuntan a la **misma** instancia y no hay dos clientes
 *     de Prisma en memoria.
 *
 * Todos se registran con `useFactory` porque los repositorios no son
 * resolubles por tipo de parámetro (`db: Db` es el cliente o el de una
 * transacción).
 *
 * `PrismaService` también va con `useFactory`: su constructor recibe un objeto
 * de opciones, y Nest intentaría resolver ese parámetro como si fuera un
 * provider. La factory lo construye con el `DATABASE_URL` ya validado por
 * `validateEnv`, de modo que la URL no se lee dos veces ni se puede
 * desincronizar del esquema de entorno.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new PrismaService({
          connectionString: config.get("DATABASE_URL", { infer: true }),
        }),
      inject: [ConfigService],
    },
    {
      provide: CryptoService,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new CryptoService(config.get("ENCRYPTION_KEY", { infer: true })),
      inject: [ConfigService],
    },
    PrismaUnitOfWork,
    {
      provide: PrismaUserRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaUserRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PrismaTenantRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaTenantRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PrismaMembershipRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaMembershipRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PrismaRefreshTokenRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaRefreshTokenRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PrismaVerificationTokenRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaVerificationTokenRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PrismaPasswordResetTokenRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaPasswordResetTokenRepository(prisma.db),
      inject: [PrismaService],
    },
    { provide: USER_REPOSITORY, useExisting: PrismaUserRepository },
    { provide: TENANT_REPOSITORY, useExisting: PrismaTenantRepository },
    { provide: MEMBERSHIP_REPOSITORY, useExisting: PrismaMembershipRepository },
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      useExisting: PrismaRefreshTokenRepository,
    },
    {
      provide: VERIFICATION_TOKEN_REPOSITORY,
      useExisting: PrismaVerificationTokenRepository,
    },
    {
      provide: PASSWORD_RESET_TOKEN_REPOSITORY,
      useExisting: PrismaPasswordResetTokenRepository,
    },
    {
      provide: PrismaInvitationRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaInvitationRepository(prisma.db),
      inject: [PrismaService],
    },
    { provide: INVITATION_REPOSITORY, useExisting: PrismaInvitationRepository },
    { provide: UNIT_OF_WORK, useExisting: PrismaUnitOfWork },
    {
      provide: PrismaDependencyProbe,
      useFactory: (prisma: PrismaService) =>
        new PrismaDependencyProbe(prisma.db),
      inject: [PrismaService],
    },
    { provide: DEPENDENCY_PROBE, useExisting: PrismaDependencyProbe },
    {
      provide: PrismaWhatsappAccountRepository,
      useFactory: (
        prisma: PrismaService,
        crypto: CryptoService,
      ) => new PrismaWhatsappAccountRepository(prisma.db, crypto),
      inject: [PrismaService, CryptoService],
    },
    {
      provide: PrismaWhatsappEventRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaWhatsappEventRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: WHATSAPP_ACCOUNT_REPOSITORY,
      useExisting: PrismaWhatsappAccountRepository,
    },
    {
      provide: WHATSAPP_EVENT_REPOSITORY,
      useExisting: PrismaWhatsappEventRepository,
    },
    {
      provide: PrismaConversationRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaConversationRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: CONVERSATION_REPOSITORY,
      useExisting: PrismaConversationRepository,
    },
    {
      provide: PrismaLlmRunRepository,
      useFactory: (prisma: PrismaService) =>
        new PrismaLlmRunRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: LLM_RUN_REPOSITORY,
      useExisting: PrismaLlmRunRepository,
    },
    {
      provide: RedisDependencyProbe,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new RedisDependencyProbe(config.get("REDIS_URL", { infer: true })),
      inject: [ConfigService],
    },
    {
      provide: DEPENDENCY_PROBES,
      useFactory: (
        postgres: PrismaDependencyProbe,
        redis: RedisDependencyProbe,
      ) => [postgres, redis],
      inject: [PrismaDependencyProbe, RedisDependencyProbe],
    },
  ],
  exports: [
    PrismaService,
    PrismaUnitOfWork,
    PrismaDependencyProbe,
    PrismaUserRepository,
    PrismaTenantRepository,
    PrismaMembershipRepository,
    PrismaRefreshTokenRepository,
    PrismaVerificationTokenRepository,
    PrismaPasswordResetTokenRepository,
    PrismaInvitationRepository,
    PrismaWhatsappAccountRepository,
    PrismaWhatsappEventRepository,
    PrismaConversationRepository,
    PrismaLlmRunRepository,
    CryptoService,
    INVITATION_REPOSITORY,
    USER_REPOSITORY,
    TENANT_REPOSITORY,
    MEMBERSHIP_REPOSITORY,
    REFRESH_TOKEN_REPOSITORY,
    VERIFICATION_TOKEN_REPOSITORY,
    PASSWORD_RESET_TOKEN_REPOSITORY,
    WHATSAPP_ACCOUNT_REPOSITORY,
    WHATSAPP_EVENT_REPOSITORY,
    CONVERSATION_REPOSITORY,
    LLM_RUN_REPOSITORY,
    UNIT_OF_WORK,
    DEPENDENCY_PROBE,
    DEPENDENCY_PROBES,
  ],
})
export class DatabaseModule {}
