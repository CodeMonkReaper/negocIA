import { prisma } from "../index";
import { checkConnection } from "../check-connection";

async function main(): Promise<void> {
  const rows = await checkConnection(prisma);
  console.log(
    `[db:check] PostgreSQL connection OK -> ${JSON.stringify(rows)}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("[db:check] PostgreSQL connection FAILED", error);
    process.exitCode = 1;
  });