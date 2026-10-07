import { defineConfig } from "vitest/config";

/**
 * Unitarios de `@negocia/database`.
 *
 * Solo prueban el factory de PrismaClient (que no abre conexión al
 * construirlo) y el helper de `checkConnection`, inyectado con un stub para
 * no depender de PostgreSQL en estos tests. El cliente generado se excluye
 * por ser ruido sin lógica propia.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "dist/**", "src/generated/**"],
  },
});