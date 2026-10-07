import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiError, ApiErrorCode } from "@negocia/contracts";
import { AppError } from "../../domain/errors";
import { getCorrelationId } from "../correlation/async-context";
import { StructuredLogger } from "../logger/structured-logger";
import { generateErrorId } from "../logger/error-id-generator";
import { sanitizeLogData } from "../logger/log-sanitizer";

const HTTP_STATUS_TO_CODE: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: "validation_error",
  [HttpStatus.UNAUTHORIZED]: "invalid_credentials",
  [HttpStatus.FORBIDDEN]: "forbidden",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
  [HttpStatus.BAD_GATEWAY]: "external_provider_error",
};

interface ResolvedError {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  serverError: boolean;
  errorId: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  // El filtro se instancia por contenedor, no por request: el umbral se
  // resuelve una vez. `error`/`fatal` nunca se filtran (severidad 0/1 ≤
  // cualquier umbral), así que subir `LOG_LEVEL` nunca puede esconder el
  // motivo de un 500.
  private readonly logger = StructuredLogger.fromEnv();

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const resolved = this.resolve(exception);
    const path = `${req.method} ${req.url}`;

    const payload: ApiError = {
      code: resolved.code,
      message: resolved.message,
      errorId: resolved.errorId,
      ...(resolved.details !== undefined
        ? { details: resolved.details }
        : {}),
      ...(getCorrelationId() ? { requestId: getCorrelationId() } : {}),
    };

    this.log(resolved, path, exception);
    res.status(resolved.status).json(payload);
  }

  private resolve(exception: unknown): ResolvedError {
    const errorId = generateErrorId();

    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code as ApiErrorCode,
        message: exception.message,
        ...(exception.details !== undefined
          ? {
              // Sanitizar details para no exponer información interna de BD
              details: this.sanitizeDetails(exception.details),
            }
          : {}),
        serverError: exception.status >= 500,
        errorId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: HTTP_STATUS_TO_CODE[status] ?? "internal_server_error",
        message: this.httpExceptionMessage(exception),
        serverError: status >= 500,
        errorId,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "internal_server_error",
      message: "Error interno del servidor",
      serverError: true,
      errorId,
    };
  }

  private httpExceptionMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === "string") {
      return response;
    }
    const message = (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) {
      return message.join(". ");
    }
    if (typeof message === "string") {
      return message;
    }
    return exception.message;
  }

  private log(
    resolved: ResolvedError,
    path: string,
    exception: unknown,
  ): void {
    const stack =
      exception instanceof Error ? (exception.stack ?? undefined) : undefined;
    // Sanitizar details antes de loguear
    const details =
      resolved.details !== undefined
        ? sanitizeLogData(resolved.details)
        : undefined;

    const meta = {
      status: resolved.status,
      code: resolved.code,
      errorId: resolved.errorId,
      path,
      ...(details !== undefined ? { details } : {}),
      // Loguear stack en logs pero no exponerlo en HTTP response
      ...(stack ? { stack } : {}),
    };

    if (resolved.serverError) {
      this.logger.error(resolved.message, "AllExceptionsFilter", meta);
    } else {
      this.logger.warn(resolved.message, "AllExceptionsFilter", meta);
    }
  }

  /**
   * Sanitiza details para evitar exponer información interna de BD.
   * 
   * Reemplaza constraint names, tipos de BD, etc. con valores genéricos.
   */
  private sanitizeDetails(details: unknown): unknown {
    if (typeof details !== "object" || details === null) {
      return details;
    }

    const obj = details as Record<string, unknown>;

    // Filtrar claves de BD que expongan schema
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (
        key === "constraint" ||
        key === "field" ||
        key === "code" ||
        key === "meta"
      ) {
        // No exponer estos detalles de BD en respuesta HTTP
        continue;
      }
      filtered[key] = value;
    }

    return filtered;
  }
}