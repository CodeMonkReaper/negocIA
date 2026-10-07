import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { Resend } from "resend";
import { EMAIL_SENDER } from "../common/di-tokens";
import { MockEmailAdapter } from "./email-sender.mock";
import { ResendEmailAdapter } from "./email-sender.resend";

/**
 * Composition root del canal de email.
 *
 * Selecciona el adaptador por `EMAIL_DRIVER` (validado en `validateEnv`):
 *
 *  - `mock`: `MockEmailAdapter` (buffer en memoria; dev/test).
 *  - `resend`: `ResendEmailAdapter` sobre la API de Resend (producción).
 *
 * `EMAIL_SENDER` se resuelve por factory para aislar la elección de driver sin
 * que los consumidores (auth, invitaciones) vean la infraestructura. `MockEmailAdapter`
 * se **exporta** además del token: los tests de integración/e2e lo recuperan con
 * `app.get(MockEmailAdapter)` para leer los "correos" enviados y aceptar invitaciones.
 */
@Module({
  providers: [
    { provide: MockEmailAdapter, useFactory: () => new MockEmailAdapter() },
    {
      provide: ResendEmailAdapter,
      // Solo se instancia con `EMAIL_DRIVER=resend`: construir el cliente
      // Resend exige API key y lanzaría en dev/test, donde el retorno es
      // `undefined` y el selector elige el mock.
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        config.get("EMAIL_DRIVER", { infer: true }) === "resend"
          ? new ResendEmailAdapter(
              new Resend(config.get("RESEND_API_KEY", { infer: true })),
              {
                apiKey: config.get("RESEND_API_KEY", { infer: true }),
                from: config.get("EMAIL_FROM", { infer: true }),
                fromName: config.get("EMAIL_FROM_NAME", { infer: true }),
                baseUrl: config.get("APP_BASE_URL", { infer: true }),
              },
            )
          : undefined,
      inject: [ConfigService],
    },
    {
      provide: EMAIL_SENDER,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        mock: MockEmailAdapter,
        resend: ResendEmailAdapter | undefined,
      ) => (config.get("EMAIL_DRIVER", { infer: true }) === "resend" ? resend : mock),
      inject: [ConfigService, MockEmailAdapter, ResendEmailAdapter],
    },
  ],
  exports: [EMAIL_SENDER, MockEmailAdapter],
})
export class EmailModule {}