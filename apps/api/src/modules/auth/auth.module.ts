import { Module } from "@nestjs/common";
import {
  ACCESS_TOKEN_ISSUER,
  ID_GENERATOR,
  OPAQUE_TOKEN_GENERATOR,
  PASSWORD_HASHER,
  TOKEN_HASHER,
} from "../../common/di-tokens";
import { EmailModule } from "../../infrastructure/email.module";
import { Sha256TokenHasher } from "../../infrastructure/token-hasher.sha256";
import { Argon2PasswordHasher } from "../../infrastructure/security/argon2-password-hasher";
import { JwtAccessTokenIssuer } from "../../infrastructure/security/jwt-access-token-issuer";
import {
  CryptoOpaqueTokenGenerator,
  UuidIdGenerator,
} from "../../infrastructure/security/opaque-token-generator";
import { AuthConfigService } from "./application/auth-config.service";
import { AuthService } from "./application/auth.service";
import { EmailVerificationSender } from "./application/email-verification-sender";
import { PasswordResetSender } from "./application/password-reset-sender";
import { SessionService } from "./application/session.service";
import { AuthController, MeController } from "./presentation/auth.controller";

/**
 * Composition root del slice de auth.
 *
 * Es el único lugar del código que conoce a la vez los puertos (dominio) y
 * sus implementaciones (infraestructura). El binding es doble, igual que en
 * `DatabaseModule`:
 *
 *  - `useFactory` para lo que necesita configuración (`Argon2PasswordHasher`
 *    con sus costes, `JwtAccessTokenIssuer` con el secreto ya validado).
 *  - `useExisting` para lo que es un objeto sin estado
 *    (`Sha256TokenHasher`, `CryptoOpaqueTokenGenerator`), de modo que la
 *    instancia del puerto y la de la clase concreta sean la misma.
 *
 * `EmailSender` no se registra aquí: viene de `EmailModule` (selección por
 * `EMAIL_DRIVER`) y se re-exporta para los consumidores de este módulo.
 *
 * `DatabaseModule` y `TenantContextModule` son globales, así que los
 * repositorios y el contexto de tenant llegan sin importarlos aquí.
 */
@Module({
  imports: [EmailModule],
  controllers: [AuthController, MeController],
  providers: [
    AuthConfigService,
    SessionService,
    AuthService,
    PasswordResetSender,
    // Se exporta porque `InvitationsModule` lo necesita para verificar el email
    // al aceptar una invitación, que es el mismo camino de código que
    // `POST /v1/email-verification/verify`.
    EmailVerificationSender,
    {
      provide: Argon2PasswordHasher,
      useFactory: (config: AuthConfigService) =>
        new Argon2PasswordHasher({
          memoryCost: config.argon2.memoryCost,
          timeCost: config.argon2.timeCost,
          parallelism: config.argon2.parallelism,
        }),
      inject: [AuthConfigService],
    },
    {
      provide: JwtAccessTokenIssuer,
      useFactory: (config: AuthConfigService) =>
        new JwtAccessTokenIssuer({
          secret: config.jwtSecret,
          issuer: config.issuer,
          audience: config.audience,
        }),
      inject: [AuthConfigService],
    },
    { provide: CryptoOpaqueTokenGenerator, useFactory: () => new CryptoOpaqueTokenGenerator() },
    { provide: UuidIdGenerator, useFactory: () => new UuidIdGenerator() },
    { provide: Sha256TokenHasher, useFactory: () => new Sha256TokenHasher() },
    { provide: PASSWORD_HASHER, useExisting: Argon2PasswordHasher },
    { provide: ACCESS_TOKEN_ISSUER, useExisting: JwtAccessTokenIssuer },
    { provide: OPAQUE_TOKEN_GENERATOR, useExisting: CryptoOpaqueTokenGenerator },
    { provide: ID_GENERATOR, useExisting: UuidIdGenerator },
    { provide: TOKEN_HASHER, useExisting: Sha256TokenHasher },
  ],
  // `ACCESS_TOKEN_ISSUER` se exporta porque `JwtAuthGuard` se registra como
  // `APP_GUARD` en `AppModule`: un provider del módulo raíz solo puede inyectar
  // lo que exportan los módulos que ese módulo importa.
  //
  // Los tres puertos de token/email se exportan por `InvitationsModule`, que
  // genera el token opaco de la invitación, lo hashea con SHA-256 y lo envía.
  // Son singletons sin estado: compartirlos evita que el módulo de invitaciones
  // registre un segundo `CryptoOpaqueTokenGenerator` con un generador distinto.
  exports: [
    AuthService,
    AuthConfigService,
    SessionService,
    EmailVerificationSender,
    // Re-exporta `EmailModule` completo (EMAIL_SENDER y MockEmailAdapter):
    // `InvitationsModule` necesita el token de email, y los e2e leen los correos
    // con `app.get(MockEmailAdapter)`.
    EmailModule,
    ACCESS_TOKEN_ISSUER,
    OPAQUE_TOKEN_GENERATOR,
    TOKEN_HASHER,
  ],
})
export class AuthModule {}
