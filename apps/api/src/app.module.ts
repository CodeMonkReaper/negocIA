import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { resolveEnvPath, validateEnv } from "@negocia/config";
import { CorrelationModule } from "./common/correlation/correlation.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { TenantContextGuard } from "./common/guards/tenant-context.guard";
import { TenantContextInterceptor } from "./common/tenant-context/tenant-context.interceptor";
import { TenantContextModule } from "./common/tenant-context/tenant-context.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { LlmModule } from "./infrastructure/llm.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ConversationsModule } from "./modules/conversations/conversations.module";
import { HealthModule } from "./modules/health/health.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { WhatsappModule } from "./modules/whatsapp/whatsapp.module";

/**
 * Cadena de guards globales en orden fijo (M-4, docs/architecture/authentication.md §7).
 *
 * El orden importa y no es intercambiable:
 *
 *  1. `ThrottlerGuard` — limita antes de tocar BD, para que un abuso no pueda
 *     consumir Argon2id ni PostgreSQL.
 *  2. `JwtAuthGuard` — verifica la firma. Es el único que decide si hay token.
 *  3. `TenantContextGuard` — relee usuario/membresía/tenant de BD y abre el
 *     `AsyncLocalStorage`. Va después de verificar la firma porque consulta BD
 *     con un `sub` que todavía no es de fiar, y antes que el guard de roles
 *     porque es quien carga el rol.
 *  4. `RolesGuard` — el último, cuando el rol ya viene de BD.
 *
 * Nest ejecuta los `APP_GUARD` en el orden de declaración del array `providers`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvPath(),
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    CorrelationModule,
    DatabaseModule,
    TenantContextModule,
    AuthModule,
    InvitationsModule,
    TenantsModule,
    HealthModule,
    WhatsappModule,
    ConversationsModule,
    // Proveedor de IA (F3-3). Sin consumidor HTTP: el consumo es solo worker
    // (F3-3b parcial: WhatsappEventsWorker → llm-jobs → ConversationEngineService).
    LlmModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Los interceptores corren **después** de los guards, que es justo lo que
    // necesita: el contexto ya fue construido contra BD.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}