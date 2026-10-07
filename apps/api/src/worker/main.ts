import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { StructuredLogger } from "../common/logger/structured-logger";
import { WorkerModule } from "../worker.module";

/**
 * Entry point del proceso worker (BullMQ), separado de la API.
 *
 * Lanza el contexto sin HTTP; los workers del módulo arrancan al compilarse y
 * mantienen el event loop vivo. `app.close()` cierra la cola y el cliente de
 * Prisma de forma ordenada; los `Worker` se cierran vía hook de Nest.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: StructuredLogger.fromEnv(),
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.close().finally(() => process.exit(0));
    });
  }
}

bootstrap().catch((error: unknown) => {
  StructuredLogger.fromEnv().error(
    "Worker de WhatsApp cayó al arrancar: " +
      (error instanceof Error ? error.message : String(error)),
    "WorkerBootstrap",
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});