/**
 * Códigos de error del dominio.
 *
 * Deben coincidir exactamente con `API_ERROR_CODES` de `@negocia/contracts`:
 * `AllExceptionsFilter` convierte este valor a `ApiErrorCode` con una
 * aserción de tipo, que el compilador no puede comprobar. La paridad la
 * comprueba en runtime `app-error.spec.ts` (misma raíz), contra el catálogo
 * real del paquete de contratos, no contra una transcripción.
 */
export const DOMAIN_ERROR_CODES = [
  "validation_error",
  "invalid_credentials",
  "invalid_refresh_token",
  "invalid_token",
  "token_expired",
  "reuse_detected",
  "account_disabled",
  "tenant_inactive",
  "membership_inactive",
  "forbidden",
  "not_found",
  "invitation_not_found",
  "user_not_found",
  "email_already_registered",
  "already_member",
  "invitation_pending",
  "email_in_use",
  "conflict",
  "rate_limited",
  "webhook_verification_failed",
  "external_provider_error",
  "llm_error",
  "database_error",
  "internal_server_error",
  // M8.1: Embedded Signup
  "embedded_signup_invalid_state",
  "embedded_signup_token_exchange_failed",
  "embedded_signup_waba_not_found",
  "embedded_signup_no_phone_numbers",
  "embedded_signup_account_creation_failed",
  "embedded_signup_missing_params",
  "embedded_signup_denied",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}