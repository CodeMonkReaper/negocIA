import { defineConfig } from "vitest/config";

/**
 * Unitarios: puros, sin red y sin PostgreSQL.
 *
 * Los archivos con sufijo `.integration.spec.ts` quedan excluidos a propósito,
 * aunque también casen con el patrón de `include`: si el `test` por defecto
 * pudiera abrir la base de datos real, dejaría de ser seguro de ejecutar en
 * cualquier máquina. Se lanzan con `pnpm --filter @negocia/api test:integration`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: [
      "**/node_modules/**",
      "dist/**",
      "**/*.integration.spec.ts",
      "test/**",
    ],
  },
});
