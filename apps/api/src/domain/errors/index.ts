import { AppError, type DomainErrorCode } from "./app-error";

export class ValidationError extends AppError {
  readonly status = 400;

  constructor(message = "Datos de entrada inválidos", details?: unknown) {
    super("validation_error", message, details);
  }
}

export class AuthenticationError extends AppError {
  readonly status = 401;

  constructor(
    code: DomainErrorCode = "invalid_credentials",
    message = "Credenciales inválidas",
    details?: unknown,
  ) {
    super(code, message, details);
  }
}

/**
 * Token de un solo uso no utilizable: invitación o verificación de email.
 *
 * **Un único código para todos los fallos** (inválido, vencido, ya usado,
 * revocado o dirigido a otro email). Distinguir los casos en la respuesta
 * convertiría el endpoint en un oráculo: quien puede distinguir "no existe" de
 * "ya se usó" puede comprobar si un email ajeno tiene una invitación viva, que
 * es información de otro usuario.
 *
 * 400 y no 404: el recurso sí existe en la ruta (el token es el parámetro), y
 * 401 insinuaría que el problema es la credencial de sesión en lugar del token
 * del cuerpo.
 */
export class InvalidTokenError extends AppError {
  readonly status = 400;

  constructor(message = "Token inválido o expirado") {
    super("invalid_token", message);
  }
}

export class AuthorizationError extends AppError {
  readonly status = 403;

  constructor(
    code: DomainErrorCode = "forbidden",
    message = "No autorizado",
    details?: unknown,
  ) {
    super(code, message, details);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;

  constructor(
    code: DomainErrorCode = "not_found",
    message = "Recurso no encontrado",
    details?: unknown,
  ) {
    super(code, message, details);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;

  constructor(
    code: DomainErrorCode = "conflict",
    message = "Conflicto con el estado actual del recurso",
    details?: unknown,
  ) {
    super(code, message, details);
  }
}

/**
 * Transición de estado de conversación no permitida por la máquina de estados
 * (`state-machine.ts`). Es un conflicto con el estado actual (409), no un 400:
 * el recurso es válido y existe; lo que no cabe es el salto pedido.
 */
export class InvalidTransitionError extends ConflictError {
  constructor(from: string, to: string) {
    super(
      "conflict",
      `Transición de conversación inválida: ${from} → ${to}`,
      { from, to },
    );
  }
}

export class RateLimitError extends AppError {
  readonly status = 429;

  constructor(message = "Demasiadas solicitudes", details?: unknown) {
    super("rate_limited", message, details);
  }
}

export class ExternalProviderError extends AppError {
  readonly status = 502;

  constructor(message = "Error de proveedor externo", details?: unknown) {
    super("external_provider_error", message, details);
  }
}

export class LlmError extends AppError {
  readonly status = 502;

  constructor(message = "Error del proveedor de IA", details?: unknown) {
    super("llm_error", message, details);
  }
}

export class DatabaseError extends AppError {
  readonly status = 500;

  constructor(message = "Error de base de datos", details?: unknown) {
    super("database_error", message, details);
  }
}

export class InternalServerError extends AppError {
  readonly status = 500;

  constructor(message = "Error interno del servidor", details?: unknown) {
    super("internal_server_error", message, details);
  }
}

/** Errores de Embedded Signup (M8.1) */

export class EmbeddedSignupInvalidStateError extends AppError {
  readonly status = 400;

  constructor(message = "State de Embedded Signup inválido o expirado") {
    super("embedded_signup_invalid_state", message);
  }
}

export class EmbeddedSignupTokenExchangeFailedError extends AppError {
  readonly status = 502;

  constructor(message = "Error intercambiando code por token de Meta", details?: unknown) {
    super("embedded_signup_token_exchange_failed", message, details);
  }
}

export class EmbeddedSignupWabaNotFoundError extends AppError {
  readonly status = 404;

  constructor(message = "No se encontró WABA asociada al usuario") {
    super("embedded_signup_waba_not_found", message);
  }
}

export class EmbeddedSignupNoPhoneNumbersError extends AppError {
  readonly status = 400;

  constructor(message = "La WABA no tiene números de teléfono disponibles") {
    super("embedded_signup_no_phone_numbers", message);
  }
}

export class EmbeddedSignupAccountCreationFailedError extends AppError {
  readonly status = 500;

  constructor(message = "Error creando la cuenta de WhatsApp", details?: unknown) {
    super("embedded_signup_account_creation_failed", message, details);
  }
}

export class EmbeddedSignupMissingParamsError extends AppError {
  readonly status = 400;

  constructor(message = "Faltan parámetros code o state en el callback") {
    super("embedded_signup_missing_params", message);
  }
}

export class EmbeddedSignupDeniedError extends AppError {
  readonly status = 403;

  constructor(message = "Usuario denegó la autorización en Meta") {
    super("embedded_signup_denied", message);
  }
}

export { AppError };
export type { DomainErrorCode } from "./app-error";