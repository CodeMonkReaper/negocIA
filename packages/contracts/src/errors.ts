export const API_ERROR_CODES = [
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

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  /** Código canónico de error (catálogo en docs/api/authentication.md §11). */
  code: ApiErrorCode;
  message: string;
  /** ID único del error para correlación en logs. Permite correlacionar errores HTTP con entries de log sin exponer stack traces. */
  errorId: string;
  details?: unknown;
  /** Correlation id del request (si existe). */
  requestId?: string;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptime: number;
  requestId?: string;
}

/**
 * Estado de una dependencia sondeada en el readiness check.
 */
export interface DependencyHealth {
  name: string;
  status: "up" | "down";
  latencyMs: number;
  /** Motivo del fallo. Solo presente si `status` es `down`. */
  error?: string;
}

/**
 * Readiness: incluye el estado real de las dependencias.
 *
 * `status` es `ok` en 200 y `down` en 503. Es a propósito distinto de
 * `HealthResponse`: la liveness no dice nada de la base de datos porque un
 * fallo de PostgreSQL no debe provocar un reinicio en bucle del proceso.
 */
export interface ReadinessResponse {
  status: "ok" | "degraded" | "down";
  service: string;
  timestamp: string;
  uptime: number;
  dependencies: DependencyHealth[];
  requestId?: string;
}
