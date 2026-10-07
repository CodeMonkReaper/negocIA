import { defineConfig } from "vitest/config";

/**
 * Unitarios de `@negocia/config`.
 *
 * `validateEnv` no toca red ni disco; `resolveEnvPath` sí usa `existsSync`
 * sobre el sistema de archivos, así que sus casos se prueban con `vi.mock`
 * de `node:fs` para que el resultado no dependa de `.env` reales colgando
 * de los directorios padre del runner.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
  },
});