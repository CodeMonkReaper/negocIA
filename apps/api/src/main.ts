import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { AppModule } from "./app.module";
import { StructuredLogger } from "./common/logger/structured-logger";
import { setupSwagger } from "./common/swagger/swagger.setup";

async function bootstrap(): Promise<void> {
  // `fromEnv` en vez de `new StructuredLogger()`: sin el umbral, `LOG_LEVEL`
  // no tenía efecto y un entorno en `warn` seguía volcando `debug`.
  const app = await NestFactory.create(AppModule, {
    logger: StructuredLogger.fromEnv(),
    // El webhook de Meta firma el cuerpo CRUDO (HMAC-SHA256); sin este flag,
    // el middleware de body no deja `req.rawBody` y no hay forma de verificar
    // la firma. Ver WhatsAppWebhookController.
    rawBody: true,
  });

  const config = app.get(ConfigService<ApiEnv, true>);

  app.setGlobalPrefix("api");
  // Sin enableVersioning, el `version: "1"` de los controllers se ignora y
  // las rutas quedan en `/api/auth/...`. Con URI versioning quedan en
  // `/api/v1/auth/...`, que es lo que documenta `docs/api/`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  setupSwagger(app);
  app.enableCors({
    origin: config.get("CORS_ORIGINS", { infer: true }),
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders:
      "Content-Type, Accept, Authorization, X-Request-Id, X-Hub-Signature-256",
  });
  app.enableShutdownHooks();

  const host: string = config.get("API_HOST", { infer: true });
  const port: number = config.get("API_PORT", { infer: true });

  await app.listen(port, host);

  StructuredLogger.fromEnv().log(
    `negocIA API listening on http://${host}:${port}/api`,
    "Bootstrap",
  );
}

void bootstrap();