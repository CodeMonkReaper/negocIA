import { InvalidTransitionError } from "../errors";
import type { ConversationStatus } from "./entities";

/**
 * Máquina de estados de la conversación (diseño legacy §11/#20).
 *
 * Reglas **puras**: no hay endpoints de transición en F2-4 (el traspaso a
 * humano llega en F6-3), pero la transición es un dominio lo bastante cargado
 * de significado como para fijarla en tablas con tests desde ya.
 *
 * Semántica:
 *   - `BOT_ACTIVE → HUMAN_REQUESTED`: el cliente pide una persona.
 *   - `HUMAN_REQUESTED → HUMAN_ACTIVE`: un operador toma la conversación.
 *   - `HUMAN_REQUESTED → BOT_ACTIVE`: el bot reconquista (p. ej. cancelación).
 *   - `HUMAN_ACTIVE → BOT_ACTIVE`: el operador devuelve el control al bot.
 *   - `* → CLOSED`: conversación resuelta/inactiva.
 *   - `CLOSED → BOT_ACTIVE`: el cliente vuelve a escribir y se reabre.
 */
export const CONVERSATION_TRANSITIONS: Readonly<
  Record<ConversationStatus, readonly ConversationStatus[]>
> = {
  BOT_ACTIVE: ["HUMAN_REQUESTED", "CLOSED"],
  HUMAN_REQUESTED: ["HUMAN_ACTIVE", "BOT_ACTIVE", "CLOSED"],
  HUMAN_ACTIVE: ["CLOSED", "BOT_ACTIVE"],
  CLOSED: ["BOT_ACTIVE"],
} as const;

export function canTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): boolean {
  return (CONVERSATION_TRANSITIONS[from] as readonly ConversationStatus[]).includes(
    to,
  );
}

/**
 * Lanza `InvalidTransitionError` si `from → to` no está permitida.
 *
 * La transición del estado guardado al candidato siempre pasa por aquí: es la
 * única puerta donde el dominio puede traducir un cambio de estado ilegal a un
 * 409 con detalle sobre la transición.
 */
export function assertValidTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function applyTransition(
  from: ConversationStatus,
  to: ConversationStatus,
): ConversationStatus {
  assertValidTransition(from, to);
  return to;
}