import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { ApiEnv } from "@negocia/config";
import {
  ConflictError,
  EmbeddedSignupAccountCreationFailedError,
} from "../../../domain/errors";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import { MetaOAuthClient } from "../../../infrastructure/whatsapp/meta-oauth";

const STATE_TTL_SECONDS = 600; // 10 min
const STATE_ISSUER = "negocia-embedded-signup";

export interface EmbeddedSignupUrlResponse {
  url: string;
  state: string;
}

export interface EmbeddedSignupCallbackResult {
  success: boolean;
  account?: WhatsappAccountRecord;
  error: string;
}

/**
 * Servicio para el flujo Embedded Signup de Meta WhatsApp (M8.1).
 *
 * Flujo:
 * 1. OWNER llama GET /embedded-signup/url -> genera state (JWT firmado) + URL OAuth Meta
 * 2. Frontend abre URL en popup -> usuario autoriza en Meta
 * 3. Meta redirige a /embedded-signup/callback?code=...&state=...
 * 4. Callback valida state, intercambia code por token, obtiene WABA + phone numbers
 * 5. Crea/actualiza WhatsappAccount (token cifrado)
 * 6. Devuelve HTML que hace postMessage al opener
 */
@Injectable()
export class EmbeddedSignupService {
  private readonly metaOAuth: MetaOAuthClient;

  constructor(
    config: ConfigService<ApiEnv, true>,
    @Inject("WHATSAPP_ACCOUNT_REPOSITORY")
    private readonly accounts: WhatsappAccountRepository,
  ) {
    this.metaOAuth = new MetaOAuthClient(
      config.get("META_APP_ID", { infer: true }),
      config.get("META_APP_SECRET", { infer: true }),
      config.get("META_EMBEDDED_SIGNUP_REDIRECT_URI", { infer: true }),
    );
  }

  /**
   * Genera la URL de autorización y un state firmado (JWT).
   *
   * El state contiene: tenantId, nonce, timestamp. Se firma con JWT_SECRET.
   * Expira en 10 min (STATE_TTL_SECONDS).
   */
  async generateAuthUrl(tenantId: string): Promise<EmbeddedSignupUrlResponse> {
    const nonce = crypto.randomUUID();
    const statePayload: JWTPayload = {
      iss: STATE_ISSUER,
      sub: tenantId,
      nonce,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    };

    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? "",
    );
    const state = await new SignJWT(statePayload)
      .setProtectedHeader({ alg: "HS256" })
      .sign(secret);

    const url = this.metaOAuth.buildAuthUrl(state);
    return { url, state };
  }

  /**
   * Procesa el callback de Meta: valida state, intercambia code, crea/actualiza cuenta.
   */
  async handleCallback(code: string, state: string): Promise<EmbeddedSignupCallbackResult> {
    // 1. Validar state (JWT)
    let payload: JWTPayload;
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "");
      const { payload: verified } = await jwtVerify(state, secret, {
        issuer: STATE_ISSUER,
      });
      payload = verified;
    } catch {
      return { success: false, error: "embedded_signup_invalid_state" };
    }

    const tenantId = payload.sub as string;
    const nonce = payload.nonce as string;

    if (!tenantId || !nonce) {
      return { success: false, error: "embedded_signup_invalid_state" };
    }

    // 2. Intercambiar code por access_token (60 días)
    let accessToken: string;
    try {
      const result = await this.metaOAuth.exchangeCodeForToken(code);
      accessToken = result.accessToken;
    } catch {
      return { success: false, error: "embedded_signup_token_exchange_failed" };
    }

    // 3. Obtener WABA info + phone numbers
    let wabaInfo;
    try {
      wabaInfo = await this.metaOAuth.getWabaInfo(accessToken);
    } catch {
      return { success: false, error: "embedded_signup_waba_not_found" };
    }

    if (wabaInfo.phoneNumbers.length === 0) {
      return { success: false, error: "embedded_signup_no_phone_numbers" };
    }

    // 4. Tomar el primer número de teléfono (el usuario puede elegir en UI futura)
    const phoneNumber = wabaInfo.phoneNumbers[0];

    // 5. Crear o actualizar cuenta
    try {
      // Verificar si ya existe una cuenta con este phone_number_id en este tenant
      const existing = await this.accounts.findByPhoneNumberId(phoneNumber.id);
      if (existing) {
        if (existing.tenantId !== tenantId) {
          // El número ya está en otro tenant
          throw new EmbeddedSignupAccountCreationFailedError(
            "Este número de WhatsApp ya está conectado a otra cuenta",
            { code: "whatsapp_account_conflict" },
          );
        }
        // Actualizar token de la cuenta existente
        const updated = await this.accounts.updateAccessToken({
          id: existing.id,
          tenantId: existing.tenantId,
          accessToken,
        });
        return { success: true, account: updated, error: "" };
      }

      const account = await this.accounts.create({
        tenantId,
        wabaId: wabaInfo.id,
        phoneNumberId: phoneNumber.id,
        displayPhone: phoneNumber.displayPhoneNumber,
        accessToken,
      });

      return { success: true, account, error: "" };
    } catch (error) {
      if (error instanceof ConflictError) {
        throw error;
      }
      return { success: false, error: "embedded_signup_account_creation_failed" };
    }
  }
}