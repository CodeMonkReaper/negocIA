import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * End-to-end HTTP contra la aplicación real (Supertest + Nest).
 *
 * El schema es el mismo `negocia_test` de la integración, recreado por el
 * `globalSetup` antes de arrancar. Los specs corren en serie y se limpian
 * entre casos por la misma razón que allí.
 *
 * `test.env` inyecta las variables en el proceso del worker. Hace falta sobre
 * todo para `DATABASE_URL`: `ConfigModule.forRoot` de `AppModule` carga el
 * `.env` del monorepo, y como no sobrescribe variables ya presentes en el
 * entorno, darle aquí la URL del schema de test gana sin tocar `process.env` a
 * mano dentro del spec.
 *
 * El `.env` se lee en este archivo y no desde un helper de `test/` a propósito:
 * Vitest carga los `.mts` de configuración como CommonJS en este repositorio y
 * no resuelven imports de `.ts` de forma fiable.
 */
function readMonorepoEnv(startDir = process.cwd()): Record<string, string> {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      const out: Record<string, string> = {};
      for (const line of readFileSync(candidate, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const eq = trimmed.indexOf("=");
        if (eq <= 0) {
          continue;
        }
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        out[trimmed.slice(0, eq).trim()] = value;
      }
      return out;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return {};
}

const env = { ...readMonorepoEnv(), ...process.env };
const testUrl = env.TEST_DATABASE_URL;

if (!testUrl || !/schema=negocia_test\b/.test(testUrl)) {
  throw new Error(
    "TEST_DATABASE_URL debe estar definida y apuntar al schema negocia_test " +
      "(los tests e2e e integración borran ese schema; nunca el de desarrollo).",
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.e2e-spec.ts"],
    env: {
      ...env,
      DATABASE_URL: testUrl,
      NODE_ENV: "test",
      // No se escucha en ningún puerto: los tests usan `app.init()` + Supertest
      // sobre el servidor en memoria. El valor solo tiene que ser válido para
      // `validateEnv`, que rechaza el 0 de "elige un puerto libre".
      API_PORT: "4001",
      LOG_LEVEL: "fatal",
      // Argon2 al mínimo: cada request paga el hash y a 19 MiB la suite pasa de
      // minutos. El algoritmo y los parámetros reales se validan en los
      // unitarios del hasher y en `validateEnv`.
      ARGON2_MEMORY_COST: "8192",
      ARGON2_TIME_COST: "1",
      ARGON2_PARALLELISM: "1",
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ["test/global-setup.ts"],
    sequence: { concurrent: false },
  },
});
