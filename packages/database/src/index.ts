import { config as loadDotenv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveEnvPath } from "@negocia/config";
import { PrismaClient } from "./generated/prisma/client";

loadDotenv({ path: resolveEnvPath(), quiet: true });

export const DEFAULT_DATABASE_URL =
  "postgresql://negocia:negocia@localhost:5432/negocia?schema=public";

/**
 * Extrae y valida el `?schema=` de una URL de conexión.
 *
 * El nombre viaja interpolado en un `SET search_path` y en la calificación de
 * tablas que genera el adapter, así que se rechaza todo lo que no sea un
 * identificador simple de PostgreSQL.
 */
function schemaFromUrl(url: string): string | null {
  const schema = new URL(url).searchParams.get("schema");
  if (!schema) {
    return null;
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Nombre de schema inválido en la URL de conexión: "${schema}"`);
  }
  return schema;
}

/**
 * Fuerza el `search_path` de la conexión a partir del `?schema=` de la URL.
 *
 * El parámetro `schema` de la URL solo lo entiende el CLI de Prisma; `pg` lo
 * ignora, así que sin esto las sentencias **raw** (`TRUNCATE`, `SET`, …) caen
 * al `search_path` por defecto (`"$user", public`). Enviar `-csearch_path=`
 * como parámetro de arranque del servidor hace que todas las conexiones del
 * pool —incluidas las transacciones— nazcan en el schema correcto.
 *
 * Un `options` ya presente en la URL se respeta sin tocar (escape manual).
 */
export function connectionStringWithSearchPath(url: string): string {
  const schema = schemaFromUrl(url);
  if (!schema) {
    return url;
  }
  const parsed = new URL(url);
  if (parsed.searchParams.has("options")) {
    return url;
  }
  parsed.searchParams.set("options", `-csearch_path=${schema}`);
  return parsed.toString();
}

/**
 * Crea un `PrismaClient` sobre el driver `pg` (Prisma 7 + `@prisma/adapter-pg`).
 *
 * El `connectionString` es explícito para que los tests de integración puedan
 * apuntar a un schema de test aislado sin depender del orden de import del
 * módulo (el singleton `prisma` ata la URL en tiempo de import).
 *
 * El `?schema=` de la URL se ataca por las dos vías por las que un cliente
 * puede hablar con la base:
 *
 *  1. **Queries generadas** (model queries): el adapter recibe `{ schema }` y
 *     califica cada tabla con él. Sin esto, el engine usaba `public` aunque la
 *     conexión estuviera en otro schema — los tests escribían contra la base de
 *     desarrollo y en CI revocaban con `42P01`.
 *  2. **Sentencias raw**: vía `search_path` de arranque en la URL (arriba).
 */
export function createPrismaClient(connectionString?: string): PrismaClient {
  const url = connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const schema = schemaFromUrl(url);
  const adapter = new PrismaPg(
    { connectionString: connectionStringWithSearchPath(url) },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  negociaPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.negociaPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.negociaPrisma = prisma;
}

export * from "./generated/prisma/client";
