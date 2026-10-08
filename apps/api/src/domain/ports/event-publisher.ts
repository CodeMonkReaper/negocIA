import type { RealtimeEventType } from "@negocia/contracts";

/**
 * Puente de eventos en tiempo real, desacoplado del transporte.
 *
 * El worker y la API publican eventos de dominio (un mensaje nuevo, un run
 * terminado) sin importar Redis ni SSE; la implementación de infraestructura
 * los vuelca a Redis y el servidor SSE los re-emite al panel.
 *
 * Los publishes son *best-effort*: un fallo de Redis no debe tumbar el flujo
 * de negocio que lo generó (el polling del panel es el fallback).
 */
export interface PublishEventInput {
  event: RealtimeEventType;
  tenantId: string;
  conversationId?: string;
  accountId?: string;
}

export interface EventPublisher {
  publish(input: PublishEventInput): Promise<void>;
}