import { defineConfig } from "vitest/config";

/**
 * Unitarios del paquete de contratos.
 *
 * Un solo archivo y sin dependencias: los contratos son tipos y constantes, así
 * que lo verificable es que las listas de literales no se separen de los CHECK
 * de la migración ni del catálogo de errores del dominio. Nada aquí abre red ni
 * base de datos, que es lo que permite ejecutar esto en cada push sin servicio.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
  },
});
