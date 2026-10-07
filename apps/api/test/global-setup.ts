import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "@negocia/database";
import { ensureEnvLoaded, testUrl } from "./helpers/env";

/**
 * Preparación global de la base de datos de test.
 *
 * Se ejecuta una vez por proceso, antes de cualquier `describe`. Hace dos
 * cosas, en este orden y sin atajos:
 *
 *  1. **Recrea el schema** `negocia_test` desde cero (`DROP ... CASCADE`).
 *     Sin esto, una migración añadida a mitad de una sesión dejaría columnas
 *     viejas y los tests pasarían contra una estructura que ya no existe en
 *     producción.
 *  2. **Aplica el historial de migraciones** con `prisma migrate deploy` (nunca
 *     `db push`): los tests deben correr contra exactamente la estructura que
 *     genera el historial versionado.
 *
 * El truncado por caso vive en `resetDatabase`; aquí no se tocan datos porque
 * este archivo corre una vez para todas las suites.
 *
 * `DATABASE_URL` se pasa al hijo por entorno, y `prisma.config.ts` usa
 * `dotenv` sin `override`, así que el valor del hijo gana al del `.env`.
 */
export default async function setup(): Promise<void> {
  ensureEnvLoaded();

  const url = testUrl();
  const schema = schemaNameOf(url);

  const admin: PrismaClient = createPrismaClient(
    process.env.DATABASE_URL ?? defaultAdminUrl(),
  );

  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.$disconnect();
  }

  const databaseDir = resolve(process.cwd(), "../../packages/database");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: databaseDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

function defaultAdminUrl(): string {
  return "postgresql://negocia:negocia@localhost:5432/negocia?schema=public";
}

function schemaNameOf(url: string): string {
  const match = /[?&]schema=([^&]+)/.exec(url);
  const schema = match?.[1];
  // El nombre va interpolado en un `DROP SCHEMA` y no admite placeholders en
  // PostgreSQL, así que se valida contra una lista de caracteres seguros en
  // lugar de confiar en la configuración.
  if (!schema || !/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Nombre de schema inválido en TEST_DATABASE_URL: "${url}"`);
  }
  return schema;
}
