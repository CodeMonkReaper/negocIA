import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_API_HOST = "0.0.0.0";
export const DEFAULT_API_PORT = 4000;
export const DEFAULT_LOG_LEVEL: LogLevel = "info";
export const DEFAULT_CORS_ORIGINS = "http://localhost:3000";

/** Valores por defecto de M-4 (auth). */
export const DEFAULT_JWT_ISSUER = "negocia-api";
export const DEFAULT_JWT_AUDIENCE = "negocia-clients";
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = 900;
export const DEFAULT_JWT_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
export const DEFAULT_ARGON2_MEMORY_COST = 19_456;
export const DEFAULT_ARGON2_TIME_COST = 2;
export const DEFAULT_ARGON2_PARALLELISM = 1;

/** Driver del canal de email (F2-1). */
export const EMAIL_DRIVERS = ["mock", "resend"] as const;
export type EmailDriver = (typeof EMAIL_DRIVERS)[number];
export const DEFAULT_EMAIL_DRIVER: EmailDriver = "mock";

/** Driver del canal Meta WhatsApp (F2-3). */
export const META_DRIVERS = ["mock", "real"] as const;
export type MetaDriver = (typeof META_DRIVERS)[number];
export const DEFAULT_META_DRIVER: MetaDriver = "mock";

/** Driver del proveedor de IA (F3-3). */
export const LLM_DRIVERS = ["mock", "openrouter"] as const;
export type LlmDriver = (typeof LLM_DRIVERS)[number];
export const DEFAULT_LLM_DRIVER: LlmDriver = "mock";
/** Base de la API de chat de OpenRouter (incluye path; el adaptador añade el endpoint). */
export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";
/**
 * Modelo por defecto: barato y rápido.
 *
 * El tráfico de un asistente de WhatsApp para PyMEs son consultas cortas y
 * frecuentes, donde el costo por token domina sobre el salto de calidad de un
 * modelo grande. Cambiarlo es una operación de configuración (`LLM_MODEL`), sin
 * redeploy: es exactamente la ventaja de haber elegido un agregador.
 */
export const DEFAULT_LLM_MODEL = "apodex/apodex-1.1-mini:free";
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;

/**
 * Secret compartido que Meta envía en `hub.verify_token` (GET /webhook).
 * Value arbitrario elegido al crear el app, no una clave criptográfica.
 */
export const MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH = 8;
/** Secret de firma `X-Hub-Signature-256` (HMAC-SHA256 del body). */
export const MIN_META_WEBHOOK_APP_SECRET_LENGTH = 16;
export const DEFAULT_EMAIL_FROM = "no-reply@negocia.app";
export const DEFAULT_EMAIL_FROM_NAME = "negocIA";
/** Base de los enlaces de acción de los emails (verificación/invitación/reset). */
export const DEFAULT_APP_BASE_URL = "http://localhost:3000";

/**
 * Longitud mínima del secreto HS256 en bytes (no caracteres).
 *
 * HS256 por diseño da ~n/2 bits de seguridad por n bytes: 32 bytes = 256 bits
 * entregados, 128 bits de resistencia a fuerza bruta, por encima del mínimo
 * aceptable para una clave de firma.
 */
export const MIN_JWT_SECRET_BYTES = 32;

export interface ApiEnv {
  NODE_ENV: NodeEnv;
  API_HOST: string;
  API_PORT: number;
  LOG_LEVEL: LogLevel;
  CORS_ORIGINS: string[];
  DATABASE_URL: string;
  /** Conexión de Redis (cola BullMQ de eventos de WhatsApp y readiness). */
  REDIS_URL: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_SECONDS: number;
  ARGON2_MEMORY_COST: number;
  ARGON2_TIME_COST: number;
  ARGON2_PARALLELISM: number;
  EMAIL_DRIVER: EmailDriver;
  /** Obligatoria cuando `EMAIL_DRIVER=resend`; ignorada con `mock`. */
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  EMAIL_FROM_NAME: string;
  /** URL base sin path para los enlaces de acción del email. */
  APP_BASE_URL: string;
  LLM_DRIVER: LlmDriver;
  /** Obligatoria cuando `LLM_DRIVER=openrouter`; ignorada con `mock`. */
  OPENROUTER_API_KEY: string;
  /** Slug del modelo en OpenRouter (`openai/gpt-4o-mini`). */
  LLM_MODEL: string;
  /** Base de la API de chat, **con** path (`https://openrouter.ai/api/v1`). */
  LLM_BASE_URL: string;
  LLM_TIMEOUT_MS: number;
  /** Opcionales: atribución en el ranking público de openrouter.ai. Vacías = no se envían. */
  LLM_APP_URL: string;
  LLM_APP_TITLE: string;
  META_DRIVER: MetaDriver;
  /** Verificación del GET /webhook de Meta (`hub.verify_token`). */
  META_WEBHOOK_VERIFY_TOKEN: string;
  /** Secret de firma `X-Hub-Signature-256` del POST /webhook. */
  META_WEBHOOK_APP_SECRET: string;
  /** Meta App ID para Embedded Signup (M8.1). */
  META_APP_ID: string;
  /** Meta App Secret para OAuth token exchange (M8.1). */
  META_APP_SECRET: string;
  /** Callback URL para Embedded Signup (debe coincidir con Meta Console). */
  META_EMBEDDED_SIGNUP_REDIRECT_URI: string;
  /** Clave de cifrado AES-256-GCM para access_token (32 bytes base64). */
  ENCRYPTION_KEY: string;
}

export function validateEnv(rawEnv: Record<string, unknown>): ApiEnv {
  const errors: string[] = [];

  const nodeEnv = String(rawEnv.NODE_ENV ?? "development");
  if (!NODE_ENVS.includes(nodeEnv as NodeEnv)) {
    errors.push(
      `NODE_ENV inválido: "${nodeEnv}" (esperado: ${NODE_ENVS.join(" | ")})`,
    );
  }

  const apiPortRaw = Number(rawEnv.API_PORT ?? DEFAULT_API_PORT);
  if (!Number.isInteger(apiPortRaw) || apiPortRaw < 1 || apiPortRaw > 65535) {
    const rawPort = String(rawEnv.API_PORT);
    // Distinguir el 0 (el SO reserva un puerto efímero, no sirve como puerto de
    // escucha estable para la API) de un valor malformado.
    errors.push(
      rawPort === "0"
        ? `API_PORT inválido: "0" (el OS asigna un puerto efímero; la API necesita un puerto fijo entre 1 y 65535)`
        : `API_PORT inválido: "${rawPort}" (debe ser un entero entre 1 y 65535)`,
    );
  }

  const logLevel = String(rawEnv.LOG_LEVEL ?? DEFAULT_LOG_LEVEL);
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    errors.push(
      `LOG_LEVEL inválido: "${logLevel}" (esperado: ${LOG_LEVELS.join(" | ")})`,
    );
  }

  const corsOrigins = String(
    rawEnv.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS,
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    errors.push("CORS_ORIGINS no puede estar vacío");
  }

  const databaseUrl = String(rawEnv.DATABASE_URL ?? "");
  if (!databaseUrl) {
    errors.push("DATABASE_URL es obligatoria");
  }

  const redisUrl = String(rawEnv.REDIS_URL ?? "");
  if (!redisUrl) {
    errors.push("REDIS_URL es obligatoria");
  }

  // `JWT_SECRET` es obligatoria en **todos** los entornos, no solo en producción.
  // Antes solo se exigía en production, pero `JwtAccessTokenIssuer` sí rechaza
  // siempre los secretos por debajo de `MIN_JWT_SECRET_BYTES`: el resultado era
  // un arranque limpio en dev/test que reventaba en el primer login con un
   // error de HS256 mucho menos descriptivo. Validar en el mismo sitio que se
  // consume hace que el fallo sea un mensaje de env, no una excepción de firma.
  //
  // Esto no rompe los tests unitarios: no arrancan Nest, y las suites de
  // integración/e2e ya inyectan su propio secreto de test.
  const jwtSecret = String(rawEnv.JWT_SECRET ?? "");
  if (!jwtSecret) {
    errors.push("JWT_SECRET es obligatoria");
  } else {
    const secretBytes = Buffer.byteLength(jwtSecret, "utf8");
    if (secretBytes < MIN_JWT_SECRET_BYTES) {
      errors.push(
        `JWT_SECRET demasiado corta: ${secretBytes} bytes (mínimo ${MIN_JWT_SECRET_BYTES} para HS256)`,
      );
    }
  }

  const accessTtl = readPositiveInt(
    rawEnv,
    "JWT_ACCESS_TTL_SECONDS",
    DEFAULT_JWT_ACCESS_TTL_SECONDS,
    errors,
  );
  const refreshTtl = readPositiveInt(
    rawEnv,
    "JWT_REFRESH_TTL_SECONDS",
    DEFAULT_JWT_REFRESH_TTL_SECONDS,
    errors,
  );

  // El refresh tiene que vivir más que el access, o un access válido podría
  // convertirse en irrecuperable sin poder renovarse.
  if (refreshTtl <= accessTtl) {
    errors.push(
      `JWT_REFRESH_TTL_SECONDS (${refreshTtl}) debe ser mayor que JWT_ACCESS_TTL_SECONDS (${accessTtl})`,
    );
  }

  const argon2MemoryCost = readPositiveInt(
    rawEnv,
    "ARGON2_MEMORY_COST",
    DEFAULT_ARGON2_MEMORY_COST,
    errors,
  );
  const argon2TimeCost = readPositiveInt(
    rawEnv,
    "ARGON2_TIME_COST",
    DEFAULT_ARGON2_TIME_COST,
    errors,
  );
  const argon2Parallelism = readPositiveInt(
    rawEnv,
    "ARGON2_PARALLELISM",
    DEFAULT_ARGON2_PARALLELISM,
    errors,
  );

  if (argon2MemoryCost < 8_192) {
    errors.push(
      `ARGON2_MEMORY_COST demasiado bajo: ${argon2MemoryCost} KiB (mínimo 8192; por debajo de 2^15 argon2id deja de ser una defensa relevante)`,
    );
  }
  if (argon2Parallelism > argon2MemoryCost) {
    errors.push(
      `ARGON2_PARALLELISM (${argon2Parallelism}) no puede superar ARGON2_MEMORY_COST (${argon2MemoryCost})`,
    );
  }

  const emailDriver = String(rawEnv.EMAIL_DRIVER ?? DEFAULT_EMAIL_DRIVER);
  if (!EMAIL_DRIVERS.includes(emailDriver as EmailDriver)) {
    errors.push(
      `EMAIL_DRIVER inválido: "${emailDriver}" (esperado: ${EMAIL_DRIVERS.join(" | ")})`,
    );
  }

  const resendApiKey = String(rawEnv.RESEND_API_KEY ?? "");
  if (emailDriver === "resend" && !resendApiKey) {
    errors.push("RESEND_API_KEY es obligatoria cuando EMAIL_DRIVER=resend");
  }

  // Un guard de sitio: el mock no envía correos, así que un despliegue que lo
  // dejara activo daría un sistema que "funciona" sin que nadie reciba nada.
  // Preferimos que falle el arranque a descubrirlo en la recepción de un alta.
  if (nodeEnv === "production" && emailDriver === "mock") {
    errors.push(
      `EMAIL_DRIVER no puede ser "mock" en producción: el adaptador de mentira no envía correos`,
    );
  }

  const emailFrom = String(rawEnv.EMAIL_FROM ?? DEFAULT_EMAIL_FROM);
  if (!/^[^@\s]+@[^@\s]+$/.test(emailFrom)) {
    errors.push(
      `EMAIL_FROM inválido: "${emailFrom}" (debe ser una dirección de email)`,
    );
  }

  const emailFromName = String(rawEnv.EMAIL_FROM_NAME ?? DEFAULT_EMAIL_FROM_NAME);
  if (!emailFromName.trim()) {
    errors.push("EMAIL_FROM_NAME no puede estar vacío");
  }

  const appBaseUrl = String(rawEnv.APP_BASE_URL ?? DEFAULT_APP_BASE_URL).trim();
  if (!isHttpUrl(appBaseUrl)) {
    errors.push(
      `APP_BASE_URL inválida: "${appBaseUrl}" (debe ser una URL http(s))`,
    );
  }

  const llmDriver = String(rawEnv.LLM_DRIVER ?? DEFAULT_LLM_DRIVER);
  if (!LLM_DRIVERS.includes(llmDriver as LlmDriver)) {
    errors.push(
      `LLM_DRIVER inválido: "${llmDriver}" (esperado: ${LLM_DRIVERS.join(" | ")})`,
    );
  }

  const openRouterApiKey = String(rawEnv.OPENROUTER_API_KEY ?? "").trim();
  if (llmDriver === "openrouter" && !openRouterApiKey) {
    errors.push("OPENROUTER_API_KEY es obligatoria cuando LLM_DRIVER=openrouter");
  }

  // Mismo guard de sitio que email y Meta: el adaptador de mentira devuelve un
  // texto fijo, así que un despliegue con `LLM_DRIVER=mock` respondería a los
  // clientes con un mensaje de pruebas. Se bloquea en producción para que falle
  // el arranque y no una conversación en vivo.
  if (nodeEnv === "production" && llmDriver === "mock") {
    errors.push(
      `LLM_DRIVER no puede ser "mock" en producción: el adaptador de mentira responde con un texto fijo`,
    );
  }

  const llmModel = String(rawEnv.LLM_MODEL ?? DEFAULT_LLM_MODEL).trim();
  if (!llmModel) {
    errors.push("LLM_MODEL no puede estar vacío");
  } else if (llmDriver === "openrouter" && !llmModel.toLowerCase().endsWith(":free")) {
    errors.push(
      `LLM_MODEL debe apuntar a un modelo gratuito de OpenRouter (ej.: "google/gemma-2-9b-it:free")`,
    );
  }

  const llmBaseUrl = String(rawEnv.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL).trim();
  if (!isHttpEndpoint(llmBaseUrl)) {
    errors.push(
      `LLM_BASE_URL inválida: "${llmBaseUrl}" (debe ser una URL http(s))`,
    );
  }

  const llmTimeoutMs = readPositiveInt(rawEnv, "LLM_TIMEOUT_MS", DEFAULT_LLM_TIMEOUT_MS, errors);

  const llmAppUrl = String(rawEnv.LLM_APP_URL ?? "").trim();
  if (llmAppUrl && !isHttpUrlWithPath(llmAppUrl)) {
    errors.push(
      `LLM_APP_URL inválida: "${llmAppUrl}" (debe ser una URL http(s))`,
    );
  }

  const llmAppTitle = String(rawEnv.LLM_APP_TITLE ?? "");

  const metaDriver = String(rawEnv.META_DRIVER ?? DEFAULT_META_DRIVER);
  if (!META_DRIVERS.includes(metaDriver as MetaDriver)) {
    errors.push(
      `META_DRIVER inválido: "${metaDriver}" (esperado: ${META_DRIVERS.join(" | ")})`,
    );
  }

  const metaVerifyToken = String(rawEnv.META_WEBHOOK_VERIFY_TOKEN ?? "").trim();
  if (metaVerifyToken.length < MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH) {
    errors.push(
      `META_WEBHOOK_VERIFY_TOKEN demasiado corto: longitud ${metaVerifyToken.length} (mínimo ${MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH})`,
    );
  }

  const metaWebhookAppSecret = String(rawEnv.META_WEBHOOK_APP_SECRET ?? "").trim();
  if (metaWebhookAppSecret.length < MIN_META_WEBHOOK_APP_SECRET_LENGTH) {
    errors.push(
      `META_WEBHOOK_APP_SECRET demasiado corto: longitud ${metaWebhookAppSecret.length} (mínimo ${MIN_META_WEBHOOK_APP_SECRET_LENGTH})`,
    );
  }

  // M8.1: Embedded Signup variables (requeridas si META_DRIVER=real)
  const metaAppId = String(rawEnv.META_APP_ID ?? "").trim();
  if (metaDriver === "real" && !metaAppId) {
    errors.push("META_APP_ID es obligatoria cuando META_DRIVER=real");
  }

  const metaAppSecret = String(rawEnv.META_APP_SECRET ?? "").trim();
  if (metaDriver === "real" && !metaAppSecret) {
    errors.push("META_APP_SECRET es obligatoria cuando META_DRIVER=real");
  }

  const metaRedirectUri = String(rawEnv.META_EMBEDDED_SIGNUP_REDIRECT_URI ?? "").trim();
  if (metaDriver === "real" && !metaRedirectUri) {
    errors.push("META_EMBEDDED_SIGNUP_REDIRECT_URI es obligatoria cuando META_DRIVER=real");
  } else if (metaRedirectUri && !isHttpUrlWithPath(metaRedirectUri)) {
    errors.push(`META_EMBEDDED_SIGNUP_REDIRECT_URI inválida: "${metaRedirectUri}" (debe ser una URL http(s))`);
  }

  // M8.5.1: Cifrado access_token. Obligatoria en todo entorno: `CryptoService`
  // se construye en `DatabaseModule` sin condicionar a META_DRIVER, así que
  // una clave vacía revienta el arranque con una excepción del cifrador en
  // lugar de un error de entorno que diga cómo generarla.
  const encryptionKey = String(rawEnv.ENCRYPTION_KEY ?? "");
  if (!encryptionKey) {
    errors.push(
      "ENCRYPTION_KEY es obligatoria (genera una: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")",
    );
  } else {
    try {
      const keyBytes = Buffer.from(encryptionKey, "base64");
      if (keyBytes.length !== 32) {
        errors.push(`ENCRYPTION_KEY debe ser 32 bytes en base64 (recibido ${keyBytes.length})`);
      }
    } catch {
      errors.push("ENCRYPTION_KEY debe ser base64 válido");
    }
  }

  // Guard de sitio análogo al de email: el mock no intercambia nada con Meta,
  // así que un despliegue con `META_DRIVER=mock` no recibiría ni validaría
  // eventos reales. Se bloquea en producción para fallar en el arranque.
  if (nodeEnv === "production" && metaDriver === "mock") {
    errors.push(
      `META_DRIVER no puede ser "mock" en producción: el webhook de mentira no recibe eventos de Meta`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Variables de entorno inválidas:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return {
    NODE_ENV: nodeEnv as NodeEnv,
    API_HOST: String(rawEnv.API_HOST ?? DEFAULT_API_HOST),
    API_PORT: apiPortRaw,
    LOG_LEVEL: logLevel as LogLevel,
    CORS_ORIGINS: corsOrigins,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    JWT_SECRET: jwtSecret,
    JWT_ISSUER: String(rawEnv.JWT_ISSUER ?? DEFAULT_JWT_ISSUER),
    JWT_AUDIENCE: String(rawEnv.JWT_AUDIENCE ?? DEFAULT_JWT_AUDIENCE),
    JWT_ACCESS_TTL_SECONDS: accessTtl,
    JWT_REFRESH_TTL_SECONDS: refreshTtl,
    ARGON2_MEMORY_COST: argon2MemoryCost,
    ARGON2_TIME_COST: argon2TimeCost,
    ARGON2_PARALLELISM: argon2Parallelism,
    EMAIL_DRIVER: emailDriver as EmailDriver,
    RESEND_API_KEY: resendApiKey || "",
    EMAIL_FROM: emailFrom,
    EMAIL_FROM_NAME: emailFromName,
    APP_BASE_URL: appBaseUrl,
    LLM_DRIVER: llmDriver as LlmDriver,
    OPENROUTER_API_KEY: openRouterApiKey || "",
    LLM_MODEL: llmModel,
    LLM_BASE_URL: llmBaseUrl,
    LLM_TIMEOUT_MS: llmTimeoutMs,
    LLM_APP_URL: llmAppUrl,
    LLM_APP_TITLE: llmAppTitle,
    META_DRIVER: metaDriver as MetaDriver,
    META_WEBHOOK_VERIFY_TOKEN: metaVerifyToken,
    META_WEBHOOK_APP_SECRET: metaWebhookAppSecret,
    META_APP_ID: metaAppId,
    META_APP_SECRET: metaAppSecret,
    META_EMBEDDED_SIGNUP_REDIRECT_URI: metaRedirectUri,
    ENCRYPTION_KEY: encryptionKey,
  };
}

/**
 * URL http(s) bien formada.
 *
 * Se aceptan solo los esquemas http/https: `APP_BASE_URL` alimenta enlaces de
 * email, y un esquema raro (`file://`, `javascript:`, …) convertiría el email
 * en un vector. Sin path ni query: la base es para componer rutas sobre ella.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    // Sin path/query/hash: la base es para componer rutas sobre ella.
    return url.pathname === "" || url.pathname === "/";
  } catch {
    return false;
  }
}

function isHttpUrlWithPath(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * URL http(s) que puede llevar path.
 *
 * Distinta de `isHttpUrl` a propósito: `LLM_BASE_URL` es un endpoint con path
 * (`https://openrouter.ai/api/v1`), no una base sobre la que componer rutas, así
 * que no debe exigir pathname vacío. Mantiene la restricción de esquema: la
 * cadena viaja a `fetch`, y un `file://` o `javascript:` no es un endpoint HTTP.
 */
function isHttpEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Lee un entero positivo del entorno.
 *
 * `Number("")` es `0` y `Number("12abc")` es `NaN`: ambos casos se cuelan en
 * una conversión ingenua y llegarían hasta la librería de JWT o Argon2 como
 * valores absurdos, así que se rechazan aquí.
 */
function readPositiveInt(
  rawEnv: Record<string, unknown>,
  key: string,
  fallback: number,
  errors: string[],
): number {
  const raw = rawEnv[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(
      `${key} inválido: "${String(raw)}" (debe ser un entero positivo)`,
    );
    return fallback;
  }
  return value;
}

/**
 * Resuelve la ruta del archivo `.env` de la raíz del monorepo.
 *
 * pnpm define `INIT_CWD` con el directorio desde donde se invocó pnpm (raíz
 * del repo en desarrollo), pero no está garantizado en toda cadena de
 * ejecución (turbo lanza los scripts de cada paquete con `cwd = <paquete>` y
 * en algunos entornos `INIT_CWD` llega indefinido, como al arrancar desde un
 * lanzador ajeno al terminal). Por eso, además del valor de `INIT_CWD`, se
 * sube desde ese directorio buscando el primer `.env` hacia la raíz del
 * monorepo (mismo patrón que el helper de tests `apps/api/test/helpers/env.ts`).
 */
export function resolveEnvPath(): string {
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  return findEnvFile(baseDir) ?? resolve(baseDir, ".env");
}

function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}