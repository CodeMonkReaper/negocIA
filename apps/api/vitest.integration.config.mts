import { defineConfig } from "vitest/config";

/**
 * Integración contra PostgreSQL real (schema `negocia_test`).
 *
 * Corre en un solo archivo a la vez: los casos comparten el mismo schema y se
 * limpian entre sí, así que correrlos en paralelo dentro de la misma máquina
 * daría falsos negativos por interferencia de datos.
 *
 * El `.env` del monorepo lo carga `test/helpers/env.ts` dentro de cada proceso
 * (global setup y workers), no el config: los `.mts` de Vitest se cargan como
 * CommonJS en este repositorio y no resuelven imports de forma fiable.
 *
 * `setupFiles` apunta `DATABASE_URL` al schema de test en cada worker antes de
 * importar los specs: `PrismaService` construye su cliente con esa variable, y
 * sin esto operaba contra el schema `public` (la BD de desarrollo en local, una
 * base vacía en CI).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.integration.spec.ts",
      "test/**/*.integration.spec.ts",
    ],
    setupFiles: ["test/helpers/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ["test/global-setup.ts"],
    sequence: { concurrent: false },
  },
});
