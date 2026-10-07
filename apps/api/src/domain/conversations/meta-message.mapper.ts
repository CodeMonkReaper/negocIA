import type {
  DeliveryStatusUpdate,
  InboundMessageDraft,
} from "./entities";
import { isDeliveryStatus } from "./entities";

/**
 * Parser puro del payload crudo de Meta (`change.value`) → drafts de dominio.
 *
 * Meta agrupa en un mismo `value` mensajes entrantes (`messages[]`), estados de
 * entrega (`statuses[]`) y contactos (`contacts[]`). La función es **total**: un
 * `value` malformado devuelve listas vacías en lugar de lanzar, igual que el
 * webhook responde 200 sin tocar la base ante un payload inválido.
 *
 * `metadata` conserva el objeto crudo del mensaje: los tool-calling de F3-3 y el
 * diagnóstico necesitan el dato tal y como lo envió Meta.
 */

const CAPTION_TYPES = ["image", "video", "document", "audio", "sticker"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Extrae el texto humano-máquina según el tipo de mensaje de Meta. */
function extractContent(message: Record<string, unknown>, type: string): string | null {
  if (type === "text") {
    const text = asRecord(message.text);
    return typeof text.body === "string" && text.body.length > 0 ? text.body : null;
  }
  if ((CAPTION_TYPES as readonly string[]).includes(type)) {
    const payload = asRecord(message[type]);
    return typeof payload.caption === "string" && payload.caption.length > 0
      ? payload.caption
      : null;
  }
  return null;
}

export function parseCustomerName(value: unknown): string | null {
  for (const contact of asArray(asRecord(value).contacts)) {
    const profile = asRecord(contact).profile;
    const name = asRecord(profile).name;
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }
  return null;
}

export function parseInboundMessages(value: unknown): InboundMessageDraft[] {
  const root = asRecord(value);
  const customerName = parseCustomerName(value);
  const drafts: InboundMessageDraft[] = [];

  for (const raw of asArray(root.messages)) {
    const message = asRecord(raw);
    const id = message.id;
    const from = message.from;
    if (typeof id !== "string" || typeof from !== "string") {
      continue;
    }
    const type = typeof message.type === "string" ? message.type : "unknown";
    drafts.push({
      providerMessageId: id,
      customerWaId: from,
      customerName,
      type,
      content: extractContent(message, type),
      timestamp: typeof message.timestamp === "string" ? message.timestamp : "",
      metadata: raw,
    });
  }

  return drafts;
}

export function parseDeliveryStatusUpdates(value: unknown): DeliveryStatusUpdate[] {
  const root = asRecord(value);
  const updates: DeliveryStatusUpdate[] = [];

  for (const raw of asArray(root.statuses)) {
    const status = asRecord(raw);
    const id = status.id;
    if (typeof id !== "string" || !isDeliveryStatus(status.status)) {
      continue;
    }
    updates.push({
      providerMessageId: id,
      deliveryStatus: status.status,
    });
  }

  return updates;
}