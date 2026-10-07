import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { WHATSAPP_ACCOUNT_REPOSITORY } from "../../../common/di-tokens";
import { StructuredLogger } from "../../../common/logger/structured-logger";
import { WhatsAppTokenExpiredError } from "../../../domain/errors";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import { MetaOAuthClient } from "../../../infrastructure/whatsapp/meta-oauth";

/**
 * Anticipación con la que se renueva el token antes de su vencimiento real.
 *
 * Un token de Meta renovado con `fb_exchange_token` vale 60 días; renovar con
 * 10 días de margen cubre ventanas de caída del provider/API/respaldos y deja
 * el `tokenExpiresAt` siempre "adelantado" respecto al punto real de no retorno
 * (Meta rechaza la renovación de un token ya vencido con error 190).
 */
export const TOKEN_REFRESH_LEAD_DAYS = 10;

export interface TokenRefreshOutcome {
  refreshed: number;
  skipped: number;
  failed: number;
}

/**
 * Renovación programada del access_token de Meta por cuenta (M8.2).
 *
 * El trabajo del job diario (`refreshDueAccounts`) escanea cuentas cuyo
 * `tokenExpiresAt` cae en los próximos `TOKEN_REFRESH_LEAD_DAYS` — o no está
 * fechado (NULL: cuenta de antes de la columna) — y las re-firma con
 * `fb_exchange_token`, guardando el nuevo token cifrado y su vencimiento.
 *
 * Garantías:
 *  - Faillures aisladas: un fallo por cuenta no aborta el resto (el job no DEBE
 *    morir por una cuenta).
 *  - Token ya vencido detectado al renovar (190/401): la cuenta pasa a
 *    `TOKEN_EXPIRED` (patrón: "renovación programada + avisos"); un token muerto
 *    no se puede reactivar con `fb_exchange_token`, requiere re-signup.
 *  - `META_DRIVER=mock`: no-op; en desarrollo no tiene sentido renovar contra
 *    Meta y el endpoint no debe salir del proceso.
 */
@Injectable()
export class TokenRefreshService {
  private readonly oauth: MetaOAuthClient;
  private readonly driver: ApiEnv["META_DRIVER"];
  private readonly logger = StructuredLogger.fromEnv();

  constructor(
    config: ConfigService<ApiEnv, true>,
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsappAccountRepository,
  ) {
    this.driver = config.get("META_DRIVER", { infer: true });
    this.oauth = new MetaOAuthClient(
      config.get("META_APP_ID", { infer: true }),
      config.get("META_APP_SECRET", { infer: true }),
      config.get("META_EMBEDDED_SIGNUP_REDIRECT_URI", { infer: true }),
    );
  }

  async refreshDueAccounts(): Promise<TokenRefreshOutcome> {
    if (this.driver === "mock") {
      return { refreshed: 0, skipped: 0, failed: 0 };
    }

    const cutoff = new Date(
      Date.now() + TOKEN_REFRESH_LEAD_DAYS * 24 * 60 * 60 * 1_000,
    );
    const due = await this.accounts.findExpiringBefore(cutoff);
    const outcome: TokenRefreshOutcome = { refreshed: 0, skipped: 0, failed: 0 };

    for (const account of due) {
      try {
        const { accessToken, expiresIn } =
          await this.oauth.exchangeLongLivedToken(account.accessToken);
        await this.accounts.updateAccessToken({
          id: account.id,
          tenantId: account.tenantId,
          accessToken,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1_000),
        });
        outcome.refreshed += 1;
        this.logger.debug(
          "WhatsApp token renew",
          "TokenRefreshService",
          { accountId: account.id, tenantId: account.tenantId },
        );
      } catch (error) {
        outcome.failed += 1;
        if (error instanceof WhatsAppTokenExpiredError) {
          try {
            await this.accounts.markTokenExpired(account.id);
          } catch {
            // La anotación es diagnóstica: su fallo no debe ocultar el real.
          }
          this.logger.warn(
            "WhatsApp token already expired, marked TOKEN_EXPIRED",
            "TokenRefreshService",
            { accountId: account.id, tenantId: account.tenantId },
          );
        } else {
          this.logger.error(
            "WhatsApp token renewal failed",
            "TokenRefreshService",
            {
              accountId: account.id,
              tenantId: account.tenantId,
              error: String(error),
            },
          );
        }
      }
    }

    return outcome;
  }
}