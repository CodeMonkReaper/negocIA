import { config as loadDotenv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveEnvPath } from "@negocia/config";
import { PrismaClient } from "./generated/prisma/client";

loadDotenv({ path: resolveEnvPath(), quiet: true });

export const DEFAULT_DATABASE_URL =
  "postgresql://negocia:negocia@localhost:5432/negocia?schema=public";

/**
 * Crea un `PrismaClient` sobre el driver `pg` (Prisma 7 + `@prisma/adapter-pg`).
 *
 * El `connectionString` es explícito para que los tests de integración puedan
 * apuntar a un schema de test aislado sin depender del orden de import del
 * módulo (el singleton `prisma` ata la URL en tiempo de import).
 */
export function createPrismaClient(connectionString?: string): PrismaClient {
  const url = connectionString ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adapter = new PrismaPg({ connectionString: url });
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
