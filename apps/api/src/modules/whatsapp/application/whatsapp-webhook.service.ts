import { Inject, Injectable } from "@nestjs/common";
import {
  WHATSAPP_ACCOUNT_REPOSITORY,
  WHATSAPP_EVENT_QUEUER,
  WHATSAPP_EVENT_REPOSITORY,
  WHATSAPP_WEBHOOK_LOGGER,
} from "../../../common/di-tokens";
import { ExternalProviderError } from "../../../domain/errors";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappEventRepository } from "../../../domain/ports/whatsapp-event-repository";
import type { WhatsappEventQueuer } from "../../../domain/ports/whatsapp-event-queuer";
import type { WhatsappEventStatus } from "../../../domain/whatsapp/entities";

export interface WebhookIngestReport {
  handled: number;
  ignored: number;
  duplicated: number;
}

export interface WhatsAppWebhookLogger {
  warn(message: unknown, context?: string): void;
}

interface MetaWebhookValue {
  metadata?: { phone_number_id?: string };
  messages?: { id?: string; type?: string }[];
  statuses?: { id?: string; status?: string }[];
}

const HANDLED_STATUSES: readonly WhatsappEventStatus[] = [
  "ENQUEUED",
  "PROCESSED",
  "DEDUPLICATED",
];

/**
 * Ingesta del webhook de WhatsApp (docs/architecture/whatsapp.md §webhook).
 *
 * Pipeline para cada cambio de Meta: resolver cuenta (`phone_number_id`) →
 * persistir evento (`provider_event_id` UNIQUE) → enqueue a BullMQ → HTTP 200.
 * El request nunca hace trabajo pesado; el worker consume después.
 *
 * Idempotencia: `provider_event_id` UNIQUE en base + `jobId` en BullMQ. Un
 * redelivery de Meta sobre un evento ya ENQUEUED/PROCESSED es no-op; sobre uno
 * RECEIVED/FAILED (nunca enqueueado o fallo previo) se re-enquea.
 *
 * El input llega `unknown` porque es la frontera de confianza (cuerpo JSON de
 * Meta); cada acceso se valida con `isRecord`/`Array.isArray` para que un
 * payload raro produzca un "ignorado", nunca un 500.
 */
@Injectable()
export class WhatsAppWebhookService {
  constructor(
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsappAccountRepository,
    @Inject(WHATSAPP_EVENT_REPOSITORY)
    private readonly events: WhatsappEventRepository,
    @Inject(WHATSAPP_EVENT_QUEUER)
    private readonly queuer: WhatsappEventQueuer,
    @Inject(WHATSAPP_WEBHOOK_LOGGER)
    private readonly logger: WhatsAppWebhookLogger,
  ) {}

  async ingest(input: unknown): Promise<WebhookIngestReport> {
    const report: WebhookIngestReport = { handled: 0, ignored: 0, duplicated: 0 };
    if (!isRecord(input)) {
      return report;
    }

    const entries = Array.isArray(input.entry)
      ? input.entry.filter(isRecord)
      : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes)
        ? entry.changes.filter(isRecord)
        : [];
      for (const change of changes) {
        await this.handleChange(change, report);
      }
    }

    return report;
  }

  private async handleChange(
    change: Record<string, unknown>,
    report: WebhookIngestReport,
  ): Promise<void> {
    if (change.field !== "messages" || !isRecord(change.value)) {
      report.ignored += 1;
      return;
    }
    const phoneNumberId = isRecord(change.value.metadata)
      ? change.value.metadata.phone_number_id
      : undefined;
    if (typeof phoneNumberId !== "string" || !phoneNumberId) {
      this.logger.warn(
        "Webhook de WhatsApp sin phone_number_id en el metadata; cambio ignorado",
        "WhatsAppWebhookService",
      );
      report.ignored += 1;
      return;
    }

    const account = await this.accounts.findByPhoneNumberId(phoneNumberId);
    if (!account) {
      // Cuenta desconocida: 200 para que Meta no reintente en bucle eventos
      // de números que no operamos.
      report.ignored += 1;
      return;
    }

    const items = collectItems(change.value);
    for (const item of items) {
      const outcome = await this.handleItem({
        providerEventId: item.id,
        eventType: item.eventType,
        payload: change.value,
        tenantId: account.tenantId,
        accountId: account.id,
      });
      report[outcome] += 1;
    }
  }

  private async handleItem(draft: {
    providerEventId: string;
    eventType: string;
    payload: unknown;
    tenantId: string;
    accountId: string;
  }): Promise<"handled" | "ignored" | "duplicated"> {
    const existing = await this.events.findByProviderEventId(draft.providerEventId);

    if (existing) {
      if (HANDLED_STATUSES.includes(existing.status)) {
        return "duplicated";
      }
      await this.enqueueAndMark(existing.id, draft.providerEventId);
      return "handled";
    }

    const created = await this.events.create({
      providerEventId: draft.providerEventId,
      tenantId: draft.tenantId,
      accountId: draft.accountId,
      eventType: draft.eventType,
      payload: draft.payload,
    });

    if (created) {
      await this.enqueueAndMark(created.id, draft.providerEventId);
      return "handled";
    }

    // Carrera: otro proceso insertó la misma fila primero. La relectura es la
    // fuente de verdad (el ganador pudo avanzar a ENQUEUED/PROCESSED ya).
    const winner = await this.events.findByProviderEventId(draft.providerEventId);
    if (winner && HANDLED_STATUSES.includes(winner.status)) {
      return "duplicated";
    }
    if (winner) {
      await this.enqueueAndMark(winner.id, draft.providerEventId);
      return "handled";
    }
    return "ignored";
  }

  /**
   * Encola y marca `ENQUEUED`. Si la cola falla, el evento queda `FAILED` y el
   * 500 le dice a Meta que reintente (el redelivery entrará por el camino
   * `retryable`).
   */
  private async enqueueAndMark(eventId: string, providerEventId: string): Promise<void> {
    try {
      await this.queuer.enqueue(providerEventId);
    } catch (error) {
      await this.events.markFailed(eventId);
      this.logger.warn(
        `No se pudo encolar el evento de WhatsApp ${providerEventId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "WhatsAppWebhookService",
      );
      throw new ExternalProviderError(
        "No se pudo encolar el evento de WhatsApp",
      );
    }
    await this.events.markEnqueued(eventId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectItems(
  value: MetaWebhookValue,
): { id: string; eventType: string }[] {
  const items: { id: string; eventType: string }[] = [];

  const messages = Array.isArray(value.messages) ? value.messages : [];
  for (const message of messages) {
    if (isRecord(message) && typeof message.id === "string") {
      items.push({
        id: message.id,
        eventType: `message:${typeof message.type === "string" ? message.type : "unknown"}`,
      });
    }
  }

  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  for (const status of statuses) {
    if (isRecord(status) && typeof status.id === "string") {
      items.push({
        id: status.id,
        eventType: `status:${typeof status.status === "string" ? status.status : "unknown"}`,
      });
    }
  }
  return items;
}