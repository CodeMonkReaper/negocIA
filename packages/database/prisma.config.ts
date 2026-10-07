import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

const baseDir = process.env.INIT_CWD ?? process.cwd();
loadDotenv({ path: resolve(baseDir, ".env"), quiet: true });

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://negocia:negocia@localhost:5432/negocia?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});