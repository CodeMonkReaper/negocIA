import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { ApiEnv } from "@negocia/config";
import type { Request, Response } from "express";
import { Public } from "../../../common/guards/public.decorator";
import { AuthorizationError } from "../../../domain/errors";
import {
  hubChallenge,
  isHubSubscribeRequest,
  isValidHubSignature,
} from "../../../infrastructure/whatsapp/meta-webhook-signature";
import { WhatsAppWebhookService } from "../application/whatsapp-webhook.service";

/**
 * Webhook de Meta WhatsApp Cloud API (docs/api/whatsapp.md §webhook).
 *
 * Público (no hay sesión: es Meta quien llama), pero protegido por dos
 * mecanismos que ORIGINAN aquí y no en un guard:
 *
 *  - GET: solo devuelve el challenge si `hub.mode=subscribe` y el
 *    `hub.verify_token` coincide (Meta 200; cualquiera 403).
 *  - POST: solo se procesa si `X-Hub-Signature-256` es el HMAC del cuerpo
 *    crudo firmado con el app secret.
 *
 * El request responde rápido (persistir → cola → 200); el trabajo pesado
 * ocurre en el worker. La firma se calcula sobre `req.rawBody`, por eso la app
 * se crea con `rawBody: true` (main.ts y el helper de test).
 */
@Public()
@Controller("whatsapp/webhook")
export class WhatsAppWebhookController {
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    config: ConfigService<ApiEnv, true>,
    private readonly webhook: WhatsAppWebhookService,
  ) {
    // `infer: true` ya aplicó `validateEnv`: no pueden ser undefined.
    this.verifyToken = config.get("META_WEBHOOK_VERIFY_TOKEN", { infer: true });
    this.appSecret = config.get("META_WEBHOOK_APP_SECRET", { infer: true });
  }

  @Get()
  verify(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): void {
    if (!isHubSubscribeRequest(query, this.verifyToken)) {
      throw new AuthorizationError(
        "webhook_verification_failed",
        "Verificación del webhook de WhatsApp fallida",
      );
    }
    const challenge = hubChallenge(query);
    if (!challenge) {
      throw new AuthorizationError(
        "webhook_verification_failed",
        "Falta hub.challenge",
      );
    }
    // Meta (correctamente) solo se fía de que devuelvas el challenge crudo;
    // el JSON wrapper rompería la suscripción.
    res.status(HttpStatus.OK).type("text/plain").send(challenge);
  }

  @Post()
  // Meta golpea en ráfagas al configurar el webhook; el global de 100/min
  // sería demasiado ajustado y provocaría reenvíos en bucle.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  // Un webhook responde 200, no 201: Nest por defecto devuelve 201 en POST y
  // Meta interpreta cualquier no-2xx como reenvío.
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: Request & { rawBody?: Buffer },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ handled: number; ignored: number; duplicated: number }> {
    const rawBody = req.rawBody ?? Buffer.alloc(0);

    if (
      !isValidHubSignature(rawBody, this.appSecret, req.header("x-hub-signature-256"))
    ) {
      res.status(HttpStatus.UNAUTHORIZED).send();
      return { handled: 0, ignored: 0, duplicated: 0 };
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8") || "{}");
    } catch {
      // Un cuerpo que no es JSON no puede producir eventos; 200 para que Meta
      // no reintente en bucle algo que jamás se va a procesar.
      return { handled: 0, ignored: 0, duplicated: 0 };
    }

    const report = await this.webhook.ingest(body);

    // Código 200 siempre que la firma sea válida, aun cuando no hubiera
    // cambios útiles: un 4xx haría reintentar a Meta en bucle.
    return report;
  }
}