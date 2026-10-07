import type { LoggerService } from "@nestjs/common";
import { getCorrelationId } from "../correlation/async-context";
import { sanitizeLogData } from "./log-sanitizer";

type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "verbose";

interface StructuredLogEntry {
  level: LogLevel;
  timestamp: string;
  service: string;
  message: string;
  context?: string;
  stack?: string;
  meta?: unknown;
  requestId?: string;
}

const SERVICE_NAME = "negocia-api";

/**
 * Severidad numérica por nivel, para comparar contra el umbral configurado.
 *
 * El orden es explícito y no `indexOf` sobre un array: comparar contra un
 * índice obliga a que el array y la tabla coincidan, y una entrada de más
 * silenciosamente cambiaría la semántica de todos los niveles.
 */
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verbose: 5,
};

/**
 * Niveles que `LogLevel` de `@negocia/config` **no** contempla.
 *
 * `validateEnv` acepta `fatal|error|warn|info|debug`; Nest llama `verbose`
 * para su traza de arranque. Aceptarlo es mejor que ignorarlo en silencio,
 * porque un nivel no reconocido se trataría como "no mostrar nada".
 */
const MIN_SEVERITY: Record<string, number> = {
  ...LEVEL_SEVERITY,
  // `fatal` no está en el enum de config: se admite igual para no perder la
  // línea más grave de un arranque fallido.
  fatal: 0,
};

export interface StructuredLoggerOptions {
  /** Umbral desde `LOG_LEVEL`. Por defecto `info`. */
  level?: string;
}

export class StructuredLogger implements LoggerService {
  private readonly minSeverity: number;

  constructor(options: StructuredLoggerOptions = {}) {
    this.minSeverity = resolveMinSeverity(options.level);
  }

  static fromEnv(): StructuredLogger {
    return new StructuredLogger({ level: process.env.LOG_LEVEL });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("info", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("verbose", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams);
  }

  private write(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    if (LEVEL_SEVERITY[level] > this.minSeverity) return;

    const { context, stack, meta } = this.normalize(optionalParams);

    const entry: StructuredLogEntry = {
      level,
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME,
      message: this.serializeMessage(message),
    };

    if (context) entry.context = context;
    if (stack) entry.stack = stack;
    // Sanitizar meta para evitar logging de datos sensibles
    if (meta !== undefined) entry.meta = sanitizeLogData(meta);

    const requestId = getCorrelationId();
    if (requestId) entry.requestId = requestId;

    const line = JSON.stringify(entry);

    if (level === "error" || level === "fatal") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  private normalize(
    optionalParams: unknown[],
  ): { context?: string; stack?: string; meta?: unknown } {
    const strings = optionalParams.filter(
      (param): param is string => typeof param === "string",
    );
    const others = optionalParams.filter(
      (param) => param !== undefined && typeof param !== "string",
    );

    // Convención de `LoggerService` de Nest: un único string final es el
    // **contexto** (`log(msg, "AuthService")`), y solo un bloque multilínea con
    // `at file:line:col` se interpreta como stack (`error(msg, stack, ctx)`).
    // Es la misma regla de `getContextAndStackAndMessagesToPrint` de Nest.
    let context: string | undefined;
    let stack: string | undefined;

    if (strings.length === 1) {
      context = strings[0];
    } else if (strings.length >= 2) {
      stack = strings[0];
      context = strings[1];
    }

    const meta =
      others.length === 0
        ? undefined
        : others.length === 1
          ? others[0]
          : others;

    return { context, stack, meta };
  }

  private serializeMessage(message: unknown): string {
    if (message instanceof Error) {
      return message.message;
    }
    if (typeof message === "string") {
      return message;
    }
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}

/**
 * Umbral efectivo a partir de `LOG_LEVEL`.
 *
 * Un valor desconocido cae en `info` en vez de en "no mostrar nada": si alguien
 * escribe `LOG_LEVEL=warning` (que no existe en el enum) y el logger se calla,
 * el síntoma es una aplicación que parece muda, no un error de configuración.
 */
function resolveMinSeverity(level: string | undefined): number {
  if (!level) return LEVEL_SEVERITY.info;
  const severity = MIN_SEVERITY[level.trim().toLowerCase()];
  return severity ?? LEVEL_SEVERITY.info;
}