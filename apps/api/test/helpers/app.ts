import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getStorageToken, ThrottlerStorageService } from "@nestjs/throttler";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { AppModule } from "../../src/app.module";
import { testUrl } from "./env";

/**
 * Utilidades compartidas por los tests e2e.
 */

/** Configura variables de entorno ANTES de cargar AppModule. */
function setE2ETestEnv(): void {
  const testEnv = {
    NODE_ENV: "test",
    API_PORT: "4000",
    LOG_LEVEL: "fatal",
    JWT_SECRET: "clave-de-integracion-de-32-bytes-minimo!!",
    JWT_ISSUER: "negocia-api",
    JWT_AUDIENCE: "negocia-app",
    JWT_ACCESS_TTL_SECONDS: "900",
    JWT_REFRESH_TTL_SECONDS: "2592000",
    ARGON2_MEMORY_COST: "8192",
    ARGON2_TIME_COST: "1",
    ARGON2_PARALLELISM: "1",
    EMAIL_DRIVER: "mock",
    EMAIL_FROM: "no-reply@negocia.app",
    EMAIL_FROM_NAME: "negocIA",
    APP_BASE_URL: "http://localhost:3000",
    LLM_DRIVER: "mock",
    LLM_MODEL: "openai/gpt-4o-mini",
    META_DRIVER: "mock",
    META_WEBHOOK_VERIFY_TOKEN: "negocia-dev-verify-token",
    META_WEBHOOK_APP_SECRET: "negocia-dev-app-secret-f2-3",
    META_APP_ID: "1234567890",
    META_APP_SECRET: "abcdef1234567890abcdef1234567890",
    META_EMBEDDED_SIGNUP_REDIRECT_URI: "https://test.example.com",
    ENCRYPTION_KEY: "Wt633WemPkA4Zt8eUq2rM7Qecfuh8hv3Tvk3RYKRbwI=",
    DATABASE_URL: testUrl(),
  };
  for (const [key, value] of Object.entries(testEnv)) {
    process.env[key] = value;
  }
}

/**
 * Arranca la aplicación completa con los mismos pipes que `main.ts`.
 *
 * El prefijo global y el `ValidationPipe` se replican a propósito en vez de
 * llamar a `main.ts`: este último hace `listen` y no devuelve la instancia, y
 * los tests necesitan el objeto para cerrarlo. Lo que sí se reutiliza es
 * `AppModule`, que es donde vive la cadena de guards, el filtro de errores y
 * los bindings de DI — justo lo que un test e2e debe estar probando.
 */
export async function createTestApp(): Promise<INestApplication> {
  // IMPORTANTE: configurar env ANTES de importar AppModule (que valida env en forRoot)
  setE2ETestEnv();

  const { AppModule } = await import("../../src/app.module");
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = module.createNestApplication({
    logger: false,
    // Igual que `main.ts`: el webhook de Meta firma el cuerpo crudo, y el
    // controller lo lee de `req.rawBody`.
    rawBody: true,
  });
  app.setGlobalPrefix("api");
  // Igual que `main.ts`: sin esto las rutas no llevarían el segmento `v1` y el
  // test e2e validaría una URL que el cliente real nunca recibe.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

/** Ruta de la API con la versión, tal como la ve el cliente. */
export function api(path: string): string {
  return `/api/v1${path}`;
}

/**
 * Vacía los contadores del throttler.
 *
 * La app del e2e es una sola instancia para toda la suite (arrancar Nest por
 * test cuesta ~1 s), así que sus contadores en memoria sobreviven entre casos.
 * Sin este reset, el límite de 5 registros por 10 min del primer test agotaría
 * la cuota del resto y los fallos serían de orden de ejecución, no de código.
 *
 * Se vacía por casos y no de forma global, para que la prueba que **sí** quiere
 * comprobar el 429 pueda dispararlo contando sus propios requests.
 */
export function resetThrottler(app: INestApplication): void {
  // El storage por defecto se registra bajo el token `ThrottlerStorage`, no
  // bajo su clase: buscar por `ThrottlerStorageService` falla con
  // "provider does not exist". `getStorageToken()` devuelve ese símbolo.
  const storage = app.get(getStorageToken()) as ThrottlerStorageService;
  storage.storage.clear();
}
