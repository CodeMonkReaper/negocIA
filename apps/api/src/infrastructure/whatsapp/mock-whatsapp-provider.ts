import { randomUUID } from "node:crypto";
import type {
  SendTextMessageInput,
  SendTextMessageResult,
  WhatsappProvider,
} from "../../domain/ports/whatsapp-provider";

/**
 * Driver de desarrollo/tests del canal de salida (M8).
 *
 * Devuelve un `wamid` sintético sin llamar a Meta. El guard de `validateEnv`
 * bloquea `META_DRIVER=mock` en producción: un despliegue real no puede
 * "enviar al vacío".
 */
export class MockWhatsAppProvider implements WhatsappProvider {
  async sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
    return { providerMessageId: `wamid.mock-${input.phoneNumberId}-${randomUUID()}` };
  }
}