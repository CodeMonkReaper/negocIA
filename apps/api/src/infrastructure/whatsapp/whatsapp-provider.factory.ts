import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import type { WhatsappProvider } from "../../domain/ports/whatsapp-provider";
import { MetaCloudProvider } from "./meta-cloud-provider";
import { MockWhatsAppProvider } from "./mock-whatsapp-provider";

/**
 * Selecciona el adaptador del canal de salida según `META_DRIVER`.
 *
 * Se usa como `useFactory` del token `WHATSAPP_PROVIDER` en los módulos que
 * componen el servicio de conversaciones (API y worker). Compartirlo aquí
 * mantiene la decisión real/mock en un solo lugar.
 */
export function createWhatsappProvider(config: ConfigService<ApiEnv, true>): WhatsappProvider {
  return config.get("META_DRIVER", { infer: true }) === "real"
    ? new MetaCloudProvider()
    : new MockWhatsAppProvider();
}