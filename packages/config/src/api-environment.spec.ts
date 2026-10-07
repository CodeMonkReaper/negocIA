import { describe, expect, it, vi, afterAll } from "vitest";
import type * as NodeFS from "node:fs";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  validateEnv,
  resolveEnvPath,
  DEFAULT_API_PORT,
  DEFAULT_CORS_ORIGINS,
  DEFAULT_JWT_ISSUER,
  DEFAULT_JWT_AUDIENCE,
  DEFAULT_JWT_ACCESS_TTL_SECONDS,
  DEFAULT_JWT_REFRESH_TTL_SECONDS,
  DEFAULT_ARGON2_MEMORY_COST,
  DEFAULT_ARGON2_TIME_COST,
  DEFAULT_ARGON2_PARALLELISM,
  DEFAULT_EMAIL_DRIVER,
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_FROM_NAME,
  DEFAULT_APP_BASE_URL,
  DEFAULT_META_DRIVER,
  DEFAULT_LLM_DRIVER,
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH,
  MIN_META_WEBHOOK_APP_SECRET_LENGTH,
  MIN_JWT_SECRET_BYTES,
} from "./api-environment";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFS>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

const SECRET = "x".repeat(64);
const DATABASE_URL = "postgresql://negocia:negocia@localhost:5432/negocia";
const REDIS_URL = "redis://localhost:6379";
const META_WEBHOOK_VERIFY_TOKEN = "negocia-webhook-token";
const META_WEBHOOK_APP_SECRET = "app-secret-negocia-f2-3";
const META_APP_ID = "1234567890";
const META_APP_SECRET = "abcdef1234567890abcdef1234567890";
const META_EMBEDDED_SIGNUP_REDIRECT_URI = "https://test.example.com";
const ENCRYPTION_KEY = "Wt633WemPkA4Zt8eUq2rM7Qecfuh8hv3Tvk3RYKRbwI=";

function validEnv(): Record<string, unknown> {
  return {
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "4001",
    LOG_LEVEL: "debug",
    CORS_ORIGINS: "http://a.example, http://b.example",
    DATABASE_URL,
    REDIS_URL,
    JWT_SECRET: SECRET,
    JWT_ISSUER: "iss",
    JWT_AUDIENCE: "aud",
    JWT_ACCESS_TTL_SECONDS: "600",
    JWT_REFRESH_TTL_SECONDS: "1200",
    ARGON2_MEMORY_COST: "19456",
    ARGON2_TIME_COST: "2",
    ARGON2_PARALLELISM: "1",
    META_WEBHOOK_VERIFY_TOKEN,
    META_WEBHOOK_APP_SECRET,
    META_APP_ID,
    META_APP_SECRET,
    META_EMBEDDED_SIGNUP_REDIRECT_URI,
    ENCRYPTION_KEY,
  };
}

describe("validateEnv", () => {
  it("coerce y devuelve un env válido", () => {
    const env = validateEnv(validEnv());
    expect(env.NODE_ENV).toBe("test");
    expect(env.API_HOST).toBe("127.0.0.1");
    expect(env.API_PORT).toBe(4001);
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.CORS_ORIGINS).toEqual([
      "http://a.example",
      "http://b.example",
    ]);
    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.REDIS_URL).toBe(REDIS_URL);
    expect(env.JWT_ISSUER).toBe("iss");
    expect(env.JWT_AUDIENCE).toBe("aud");
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(600);
    expect(env.JWT_REFRESH_TTL_SECONDS).toBe(1200);
    expect(env.ARGON2_MEMORY_COST).toBe(19456);
    expect(env.ARGON2_TIME_COST).toBe(2);
    expect(env.ARGON2_PARALLELISM).toBe(1);
    expect(env.EMAIL_DRIVER).toBe("mock");
    expect(env.RESEND_API_KEY).toBe("");
    expect(env.EMAIL_FROM).toBe("no-reply@negocia.app");
    expect(env.EMAIL_FROM_NAME).toBe("negocIA");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
    expect(env.META_DRIVER).toBe(DEFAULT_META_DRIVER);
    expect(env.META_WEBHOOK_VERIFY_TOKEN).toBe(META_WEBHOOK_VERIFY_TOKEN);
    expect(env.META_WEBHOOK_APP_SECRET).toBe(META_WEBHOOK_APP_SECRET);
  });

  it("aplica los defaults cuando la clave falta", () => {
    const env = validateEnv({
      JWT_SECRET: SECRET,
      DATABASE_URL,
      REDIS_URL,
      META_WEBHOOK_VERIFY_TOKEN,
      META_WEBHOOK_APP_SECRET,
      ENCRYPTION_KEY,
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_HOST).toBe("0.0.0.0");
    expect(env.API_PORT).toBe(DEFAULT_API_PORT);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual([DEFAULT_CORS_ORIGINS]);
    expect(env.JWT_ISSUER).toBe(DEFAULT_JWT_ISSUER);
    expect(env.JWT_AUDIENCE).toBe(DEFAULT_JWT_AUDIENCE);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(DEFAULT_JWT_ACCESS_TTL_SECONDS);
    expect(env.JWT_REFRESH_TTL_SECONDS).toBe(DEFAULT_JWT_REFRESH_TTL_SECONDS);
    expect(env.ARGON2_MEMORY_COST).toBe(DEFAULT_ARGON2_MEMORY_COST);
    expect(env.ARGON2_TIME_COST).toBe(DEFAULT_ARGON2_TIME_COST);
    expect(env.ARGON2_PARALLELISM).toBe(DEFAULT_ARGON2_PARALLELISM);
    expect(env.EMAIL_DRIVER).toBe(DEFAULT_EMAIL_DRIVER);
    expect(env.EMAIL_FROM).toBe(DEFAULT_EMAIL_FROM);
    expect(env.EMAIL_FROM_NAME).toBe(DEFAULT_EMAIL_FROM_NAME);
    expect(env.APP_BASE_URL).toBe(DEFAULT_APP_BASE_URL);
  });

  it("coerce EMAIL_DRIVER=resend con su API key", () => {
    const env = validateEnv({
      ...validEnv(),
      EMAIL_DRIVER: "resend",
      RESEND_API_KEY: "re_abc123",
      EMAIL_FROM: "hola@negoci.app",
      EMAIL_FROM_NAME: "negocIA",
      APP_BASE_URL: "https://app.negocia.com",
    });
    expect(env.EMAIL_DRIVER).toBe("resend");
    expect(env.RESEND_API_KEY).toBe("re_abc123");
    expect(env.EMAIL_FROM).toBe("hola@negoci.app");
    expect(env.APP_BASE_URL).toBe("https://app.negocia.com");
  });

  it("rechaza EMAIL_DRIVER fuera de la lista", () => {
    expect(() => validateEnv({ ...validEnv(), EMAIL_DRIVER: "smtp" })).toThrow(
      /EMAIL_DRIVER inválido: "smtp" \(esperado: mock \| resend\)/,
    );
  });

  it("exige RESEND_API_KEY cuando el driver es resend", () => {
    expect(() =>
      validateEnv({ ...validEnv(), EMAIL_DRIVER: "resend" }),
    ).toThrow(/RESEND_API_KEY es obligatoria cuando EMAIL_DRIVER=resend/);
  });

  it("no exige RESEND_API_KEY con el driver mock", () => {
    expect(() => validateEnv({ ...validEnv(), EMAIL_DRIVER: "mock" })).not.toThrow();
  });

  it("bloquea el driver mock en producción", () => {
    expect(() =>
      validateEnv({ ...validEnv(), NODE_ENV: "production", EMAIL_DRIVER: "mock" }),
    ).toThrow(/EMAIL_DRIVER no puede ser "mock" en producción/);
  });

  it("permite el driver resend en producción", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        NODE_ENV: "production",
        EMAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_abc123",
        META_DRIVER: "real",
        LLM_DRIVER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).not.toThrow();
  });

  it("coerce META_DRIVER=real con sus credenciales", () => {
    const env = validateEnv({ ...validEnv(), META_DRIVER: "real" });
    expect(env.META_DRIVER).toBe("real");
    expect(env.META_WEBHOOK_VERIFY_TOKEN).toBe(META_WEBHOOK_VERIFY_TOKEN);
    expect(env.META_WEBHOOK_APP_SECRET).toBe(META_WEBHOOK_APP_SECRET);
  });

  it("acepta la redirect URI de Embedded Signup con path", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        META_EMBEDDED_SIGNUP_REDIRECT_URI:
          "https://example.com/api/v1/whatsapp/embedded-signup/callback",
      }),
    ).not.toThrow();
  });

  it("rechaza META_DRIVER fuera de la lista", () => {
    expect(() => validateEnv({ ...validEnv(), META_DRIVER: "sandbox" })).toThrow(
      /META_DRIVER inválido: "sandbox" \(esperado: mock \| real\)/,
    );
  });

  it("exige META_WEBHOOK_VERIFY_TOKEN en todo entorno", () => {
    const { META_WEBHOOK_VERIFY_TOKEN: _omit, ...withoutToken } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutToken)).toThrow(
      new RegExp(
        `META_WEBHOOK_VERIFY_TOKEN demasiado corto: longitud 0 \\(mínimo ${MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH}\\)`,
      ),
    );
  });

  it("rechaza META_WEBHOOK_VERIFY_TOKEN corto", () => {
    expect(() =>
      validateEnv({ ...validEnv(), META_WEBHOOK_VERIFY_TOKEN: "abc" }),
    ).toThrow(
      new RegExp(
        `META_WEBHOOK_VERIFY_TOKEN demasiado corto: longitud 3 \\(mínimo ${MIN_META_WEBHOOK_VERIFY_TOKEN_LENGTH}\\)`,
      ),
    );
  });

  it("exige META_WEBHOOK_APP_SECRET en todo entorno", () => {
    const { META_WEBHOOK_APP_SECRET: _omit, ...withoutSecret } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutSecret)).toThrow(
      new RegExp(
        `META_WEBHOOK_APP_SECRET demasiado corto: longitud 0 \\(mínimo ${MIN_META_WEBHOOK_APP_SECRET_LENGTH}\\)`,
      ),
    );
  });

  it("bloquea META_DRIVER=mock en producción", () => {
    expect(() =>
      validateEnv({ ...validEnv(), NODE_ENV: "production", META_DRIVER: "mock" }),
    ).toThrow(/META_DRIVER no puede ser "mock" en producción/);
  });

  it("permite META_DRIVER=real en producción", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        NODE_ENV: "production",
        META_DRIVER: "real",
        EMAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_abc123",
        LLM_DRIVER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
      }),
    ).not.toThrow();
  });

  // --- Proveedor de IA (F3-3) ---

  it("aplica los defaults del proveedor de IA", () => {
    const env = validateEnv(validEnv());
    expect(env.LLM_DRIVER).toBe(DEFAULT_LLM_DRIVER);
    expect(env.OPENROUTER_API_KEY).toBe("");
    expect(env.LLM_MODEL).toBe(DEFAULT_LLM_MODEL);
    expect(env.LLM_BASE_URL).toBe(DEFAULT_LLM_BASE_URL);
    expect(env.LLM_TIMEOUT_MS).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(env.LLM_APP_URL).toBe("");
    expect(env.LLM_APP_TITLE).toBe("");
  });

  it("coerce LLM_DRIVER=openrouter con su API key y un modelo gratuito", () => {
    const env = validateEnv({
      ...validEnv(),
      LLM_DRIVER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-abc123",
      LLM_MODEL: "google/gemma-2-9b-it:free",
      LLM_BASE_URL: "https://proxy.interno/v1",
      LLM_TIMEOUT_MS: "5000",
      LLM_APP_URL: "https://app.negocia.com",
      LLM_APP_TITLE: "negocIA",
    });
    expect(env.LLM_DRIVER).toBe("openrouter");
    expect(env.OPENROUTER_API_KEY).toBe("sk-or-abc123");
    expect(env.LLM_MODEL).toBe("google/gemma-2-9b-it:free");
    expect(env.LLM_BASE_URL).toBe("https://proxy.interno/v1");
    expect(env.LLM_TIMEOUT_MS).toBe(5000);
    expect(env.LLM_APP_URL).toBe("https://app.negocia.com");
    expect(env.LLM_APP_TITLE).toBe("negocIA");
  });

  it("rechaza LLM_DRIVER fuera de la lista", () => {
    expect(() => validateEnv({ ...validEnv(), LLM_DRIVER: "anthropic" })).toThrow(
      /LLM_DRIVER inválido: "anthropic" \(esperado: mock \| openrouter\)/,
    );
  });

  it("exige OPENROUTER_API_KEY cuando el driver es openrouter", () => {
    expect(() => validateEnv({ ...validEnv(), LLM_DRIVER: "openrouter" })).toThrow(
      /OPENROUTER_API_KEY es obligatoria cuando LLM_DRIVER=openrouter/,
    );
  });

  it("no exige OPENROUTER_API_KEY con el driver mock", () => {
    expect(() => validateEnv({ ...validEnv(), LLM_DRIVER: "mock" })).not.toThrow();
  });

  it("bloquea LLM_DRIVER=mock en producción", () => {
    expect(() =>
      validateEnv({ ...validEnv(), NODE_ENV: "production", LLM_DRIVER: "mock" }),
    ).toThrow(/LLM_DRIVER no puede ser "mock" en producción/);
  });

  it("rechaza LLM_MODEL vacío", () => {
    expect(() => validateEnv({ ...validEnv(), LLM_MODEL: "   " })).toThrow(
      /LLM_MODEL no puede estar vacío/,
    );
  });

  it("requiere un modelo gratuito cuando LLM_DRIVER=openrouter", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        LLM_DRIVER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-abc123",
        LLM_MODEL: "openai/gpt-4o-mini",
      }),
    ).toThrow(/LLM_MODEL debe apuntar a un modelo gratuito de OpenRouter/);
  });

  it("acepta LLM_BASE_URL con path pero rechaza esquemas que no son http(s)", () => {
    expect(validateEnv({ ...validEnv() }).LLM_BASE_URL).toContain("/api/v1");
    expect(() => validateEnv({ ...validEnv(), LLM_BASE_URL: "file:///etc/passwd" })).toThrow(
      /LLM_BASE_URL inválida/,
    );
    expect(() => validateEnv({ ...validEnv(), LLM_BASE_URL: "openrouter.ai" })).toThrow(
      /LLM_BASE_URL inválida/,
    );
  });

  it("rechaza LLM_TIMEOUT_MS no positivo o malformado", () => {
    expect(() => validateEnv({ ...validEnv(), LLM_TIMEOUT_MS: "0" })).toThrow(
      /LLM_TIMEOUT_MS inválido: "0" \(debe ser un entero positivo\)/,
    );
    expect(() => validateEnv({ ...validEnv(), LLM_TIMEOUT_MS: "20s" })).toThrow(
      /LLM_TIMEOUT_MS inválido: "20s" \(debe ser un entero positivo\)/,
    );
  });

  it("acepta LLM_APP_URL vacía pero rechaza una inválida", () => {
    expect(validateEnv({ ...validEnv(), LLM_APP_URL: "" }).LLM_APP_URL).toBe("");
    expect(() => validateEnv({ ...validEnv(), LLM_APP_URL: "no-es-url" })).toThrow(
      /LLM_APP_URL inválida/,
    );
  });

  it("rechaza EMAIL_FROM que no parece un email", () => {
    expect(() => validateEnv({ ...validEnv(), EMAIL_FROM: "pilas" })).toThrow(
      /EMAIL_FROM inválido: "pilas"/,
    );
  });

  it("rechaza EMAIL_FROM_NAME en blanco", () => {
    expect(() =>
      validateEnv({ ...validEnv(), EMAIL_FROM_NAME: "   " }),
    ).toThrow(/EMAIL_FROM_NAME no puede estar vacío/);
  });

  it("rechaza APP_BASE_URL no http(s) o con path", () => {
    expect(() =>
      validateEnv({ ...validEnv(), APP_BASE_URL: "file:///tmp/x" }),
    ).toThrow(/APP_BASE_URL inválida/);
    expect(() =>
      validateEnv({ ...validEnv(), APP_BASE_URL: "https://app.negocia.com/auth" }),
    ).toThrow(/APP_BASE_URL inválida/);
  });

  it("rechaza NODE_ENV fuera de la lista", () => {
    expect(() => validateEnv({ ...validEnv(), NODE_ENV: "prod" })).toThrow(
      /NODE_ENV inválido: "prod" \(esperado: development \| test \| production\)/,
    );
  });

  it("distingue API_PORT=0 (efímero) de un valor malformado", () => {
    expect(() => validateEnv({ ...validEnv(), API_PORT: "0" })).toThrow(
      /API_PORT inválido: "0" \(el OS asigna un puerto efímero; la API necesita un puerto fijo entre 1 y 65535\)/,
    );
    expect(() => validateEnv({ ...validEnv(), API_PORT: "abc" })).toThrow(
      /API_PORT inválido: "abc" \(debe ser un entero entre 1 y 65535\)/,
    );
    expect(() => validateEnv({ ...validEnv(), API_PORT: "70000" })).toThrow(
      /API_PORT inválido: "70000" \(debe ser un entero entre 1 y 65535\)/,
    );
  });

  it("rechaza LOG_LEVEL fuera de la lista", () => {
    expect(() => validateEnv({ ...validEnv(), LOG_LEVEL: "verbose" })).toThrow(
      /LOG_LEVEL inválido: "verbose"/,
    );
  });

  it("rechaza CORS_ORIGINS vacío", () => {
    expect(
      () => validateEnv({ ...validEnv(), CORS_ORIGINS: "  ,  , " }),
    ).toThrow(/CORS_ORIGINS no puede estar vacío/);
  });

  it("exige DATABASE_URL", () => {
    const { DATABASE_URL: _omit, ...withoutUrl } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutUrl)).toThrow(
      /DATABASE_URL es obligatoria/,
    );
  });

  it("exige REDIS_URL", () => {
    const { REDIS_URL: _omit, ...withoutUrl } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutUrl)).toThrow(
      /REDIS_URL es obligatoria/,
    );
  });

  it("exige ENCRYPTION_KEY en todo entorno, no solo con META_DRIVER=real", () => {
    const { ENCRYPTION_KEY: _omit, ...withoutKey } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutKey)).toThrow(
      /ENCRYPTION_KEY es obligatoria/,
    );
    // También con el driver mock: `CryptoService` se construye igual en
    // `DatabaseModule` y su constructor lanza si la clave falta.
    expect(() =>
      validateEnv({ ...withoutKey, META_DRIVER: "mock" }),
    ).toThrow(/ENCRYPTION_KEY es obligatoria/);
  });

  it("rechaza ENCRYPTION_KEY que no decodifica a 32 bytes", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        ENCRYPTION_KEY: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow(/ENCRYPTION_KEY debe ser 32 bytes en base64/);
  });

  it("exige JWT_SECRET en todo entorno, no solo producción", () => {
    const { JWT_SECRET: _omit, ...withoutSecret } = validEnv();
    void _omit;
    expect(() => validateEnv(withoutSecret)).toThrow(
      /JWT_SECRET es obligatoria/,
    );
  });

  it("rechaza JWT_SECRET corta indicando los bytes reales", () => {
    const short = "x".repeat(20);
    expect(() => validateEnv({ ...validEnv(), JWT_SECRET: short })).toThrow(
      new RegExp(
        `JWT_SECRET demasiado corta: 20 bytes \\(mínimo ${MIN_JWT_SECRET_BYTES} para HS256\\)`,
      ),
    );
  });

  it("exige refresh > access", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        JWT_ACCESS_TTL_SECONDS: "900",
        JWT_REFRESH_TTL_SECONDS: "900",
      }),
    ).toThrow(
      /JWT_REFRESH_TTL_SECONDS \(900\) debe ser mayor que JWT_ACCESS_TTL_SECONDS \(900\)/,
    );
  });

  it("rechaza un memory cost de Argon2 por debajo del mínimo", () => {
    expect(() =>
      validateEnv({ ...validEnv(), ARGON2_MEMORY_COST: "4096" }),
    ).toThrow(/ARGON2_MEMORY_COST demasiado bajo: 4096 KiB \(mínimo 8192/);
  });

  it("rechaza parallelism mayor al memory cost", () => {
    expect(() =>
      validateEnv({
        ...validEnv(),
        ARGON2_MEMORY_COST: "20000",
        ARGON2_PARALLELISM: "50000",
      }),
    ).toThrow(
      /ARGON2_PARALLELISM \(50000\) no puede superar ARGON2_MEMORY_COST \(20000\)/,
    );
  });

  it("acumula todos los errores en un solo lanzamiento", () => {
    let thrown: unknown;
    try {
      validateEnv({ NODE_ENV: "prod", API_PORT: "0" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("Variables de entorno inválidas");
    expect(message).toContain("NODE_ENV inválido");
    expect(message).toContain("API_PORT inválido");
  });
});

describe("resolveEnvPath", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of new Set(tempDirs)) {
      rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.INIT_CWD;
  });

  function makeTempRoot(): string {
    const dir = join(tmpdir(), `negocia-config-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  }

  it("sube desde INIT_CWD hasta encontrar el .env", () => {
    const root = makeTempRoot();
    const envPath = join(root, ".env");
    vi.mocked(existsSync).mockImplementation((p: unknown) => p === envPath);
    process.env.INIT_CWD = join(root, "nested", "deep");
    expect(resolveEnvPath()).toBe(envPath);
  });

  it("devuelve INIT_CWD/.env si no se encuentra subiendo", () => {
    const root = makeTempRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    const cwd = join(root, "nested", "deep");
    process.env.INIT_CWD = cwd;
    expect(resolveEnvPath()).toBe(resolve(cwd, ".env"));
  });

  it("cae a process.cwd() cuando INIT_CWD no está definido", () => {
    makeTempRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    delete process.env.INIT_CWD;
    expect(resolveEnvPath()).toBe(resolve(process.cwd(), ".env"));
  });

  it("respeta el límite de seis niveles al subir", () => {
    const root = makeTempRoot();
    // .env vivo en la raíz del temp dir, pero INIT_CWD queda 8 niveles abajo:
    // supera los 6 intentos de la subida → fallback a INIT_CWD/.env.
    const envPath = join(root, ".env");
    vi.mocked(existsSync).mockImplementation((p: unknown) => p === envPath);
    const nesting = Array.from({ length: 8 }, (_, i) => `level-${i}`);
    const tooDeep = join(root, ...nesting);
    process.env.INIT_CWD = tooDeep;
    expect(resolveEnvPath()).toBe(resolve(tooDeep, ".env"));
  });
});