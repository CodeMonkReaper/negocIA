import {
  createPrismaClient,
  DEFAULT_DATABASE_URL,
  type PrismaClient,
} from "@negocia/database";
import { testUrl } from "./env";

/**
 * Utilidades compartidas por los tests de integración y e2e.
 */

const TABLES = [
  "refresh_tokens",
  "verification_tokens",
  "invitations",
  "whatsapp_events",
  "whatsapp_accounts",
  "memberships",
  "llm_runs",
  "conversations",
  "messages",
  "tenants",
  "users",
] as const;

let cached: PrismaClient | null = null;

/**
 * Cliente Prisma apuntando al schema de test.
 *
 * Se cachea a nivel de módulo: abrir un pool nuevo por test agotaría las
 * conexiones del servidor (PostgreSQL permite 100 por usuario por defecto).
 */
export function testDatabase(): PrismaClient {
  cached ??= createPrismaClient(testUrl());
  return cached;
}

export async function closeTestDatabase(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = null;
  }
}

/**
 * Deja el schema vacío.
 *
 * `TRUNCATE ... CASCADE` en una sola sentencia es más rápido que un `DELETE`
 * por tabla y respeta las claves foráneas automáticamente. El orden explícito
 * de las tablas no es necesario por eso, pero se escribe para que se lea
 * como deliberado y no como casual.
 */
export async function resetDatabase(): Promise<void> {
  await testDatabase().$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`,
  );
}

/** URL de la base de desarrollo, usada solo para crear el schema de test. */
export function adminDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
