import { beforeEach, describe, expect, it } from "vitest";
import { ExternalProviderError } from "../../../domain/errors";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappEventRepository } from "../../../domain/ports/whatsapp-event-repository";
import type { WhatsappEventQueuer } from "../../../domain/ports/whatsapp-event-queuer";
import type {
  WhatsappAccountRecord,
  WhatsappEventRecord,
  WhatsappEventStatus,
} from "../../../domain/whatsapp/entities";
import {
  WhatsAppWebhookService,
  type WhatsAppWebhookLogger,
  type WebhookIngestReport,
} from "./whatsapp-webhook.service";

const PHONE_A = "573001234567";
const PHONE_UNKNOWN = "573009999999";
const EVENT_1 = "wamid.HBgNMTE4MjcwNzc4";
const EVENT_2 = "wamid.HBgNMTE4MjcwNzc5";

function metaMessage(id: string, phoneNumberId = PHONE_A) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "351468654316532",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "573001234567", phone_number_id: phoneNumberId },
              messages: [{ from: "573100000001", id, timestamp: "1739737230", type: "text" }],
            },
          },
        ],
      },
    ],
  };
}

function metaStatus(id: string, phoneNumberId = PHONE_A) {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              statuses: [{ id, status: "sent", timestamp: "1739737230" }],
            },
          },
        ],
      },
    ],
  };
}

function account(phoneNumberId: string): WhatsappAccountRecord {
  return {
    id: "acc-1",
    tenantId: "tenant-1",
    wabaId: "waba-1",
    phoneNumberId,
    displayPhone: phoneNumberId,
    accessToken: "token",
    accessTokenEncrypted: {
      iv: "dGVzdC1pdjEyMw==",
      ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
      tag: "dGVzdC10YWc=",
    },
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function event(
  id: string,
  providerEventId: string,
  status: WhatsappEventStatus,
): WhatsappEventRecord {
  return {
    id,
    providerEventId,
    tenantId: "tenant-1",
    accountId: "acc-1",
    eventType: "message:text",
    payload: {},
    status,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    processedAt: null,
  };
}

class FakeAccounts implements WhatsappAccountRepository {
  private readonly byPhone = new Map<string, WhatsappAccountRecord>();
  private readonly byId = new Map<string, WhatsappAccountRecord>();

  set(phoneNumberId: string, record: WhatsappAccountRecord): void {
    this.byPhone.set(phoneNumberId, record);
    this.byId.set(record.id, record);
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<WhatsappAccountRecord | null> {
    return this.byPhone.get(phoneNumberId) ?? null;
  }

  async findById(tenantId: string, id: string): Promise<WhatsappAccountRecord | null> {
    const record = this.byId.get(id);
    if (!record || record.tenantId !== tenantId) {
      return null;
    }
    return record;
  }

  async listByTenant(): Promise<WhatsappAccountRecord[]> {
    return [...this.byPhone.values()];
  }

  async create(input: { phoneNumberId: string; tenantId: string }): Promise<WhatsappAccountRecord> {
    const record = account(input.phoneNumberId);
    this.byId.set(record.id, record);
    this.byPhone.set(record.phoneNumberId, record);
    return record;
  }

  async updateAccessToken(input: { id: string; tenantId: string; accessToken: string }): Promise<WhatsappAccountRecord> {
    const record = this.byId.get(input.id);
    if (!record || record.tenantId !== input.tenantId) {
      throw new Error("Account not found");
    }
    // In a real implementation, we'd encrypt the token here
    return record;
  }
}

class FakeEvents implements WhatsappEventRepository {
  private idCounter = 1;
  readonly rows = new Map<string, WhatsappEventRecord>();

  async findByProviderEventId(providerEventId: string): Promise<WhatsappEventRecord | null> {
    return this.rows.get(providerEventId) ?? null;
  }

  async create(draft: Parameters<WhatsappEventRepository["create"]>[0]): Promise<WhatsappEventRecord | null> {
    if (this.rows.has(draft.providerEventId)) {
      return null;
    }
    const record = event(`ev-${this.idCounter++}`, draft.providerEventId, "RECEIVED");
    record.eventType = draft.eventType;
    record.tenantId = draft.tenantId;
    record.accountId = draft.accountId;
    record.payload = draft.payload;
    this.rows.set(draft.providerEventId, record);
    return record;
  }

  async markEnqueued(id: string): Promise<void> {
    this.setStatus(id, "ENQUEUED");
  }

  async markProcessed(id: string): Promise<void> {
    this.setStatus(id, "PROCESSED");
  }

  async markFailed(id: string): Promise<void> {
    this.setStatus(id, "FAILED");
  }

  private setStatus(id: string, status: WhatsappEventStatus): void {
    const record = [...this.rows.values()].find((row) => row.id === id);
    if (record) {
      record.status = status;
    }
  }
}

class FakeQueuer implements WhatsappEventQueuer {
  readonly enqueued: string[] = [];
  failNext = false;

  async enqueue(providerEventId: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("ECONNREFUSED redis://localhost:6379");
    }
    this.enqueued.push(providerEventId);
  }
}

class FakeLogger implements WhatsAppWebhookLogger {
  readonly warnings: unknown[] = [];
  warn(message: unknown, context?: string): void {
    this.warnings.push({ message, context });
  }
}

describe("WhatsAppWebhookService", () => {
  let accounts: FakeAccounts;
  let events: FakeEvents;
  let queuer: FakeQueuer;
  let logger: FakeLogger;
  let service: WhatsAppWebhookService;

  beforeEach(() => {
    accounts = new FakeAccounts();
    events = new FakeEvents();
    queuer = new FakeQueuer();
    logger = new FakeLogger();
    accounts.set(PHONE_A, account(PHONE_A));
    service = new WhatsAppWebhookService(accounts, events, queuer, logger);
  });

  function report(): WebhookIngestReport {
    return { handled: 0, ignored: 0, duplicated: 0 };
  }

  describe("ingesta de un mensaje nuevo", () => {
    it("persiste, encola y marca ENQUEUED", async () => {
      const result = await service.ingest(metaMessage(EVENT_1));

      expect(result).toEqual({ handled: 1, ignored: 0, duplicated: 0 });
      expect(events.rows.has(EVENT_1)).toBe(true);
      expect(events.rows.get(EVENT_1)?.status).toBe("ENQUEUED");
      expect(events.rows.get(EVENT_1)?.tenantId).toBe("tenant-1");
      expect(queuer.enqueued).toEqual([EVENT_1]);
    });

    it("solo reenviados duplicados cuentan como duplicated (idempotencia)", async () => {
      await service.ingest(metaMessage(EVENT_1));
      const second = await service.ingest(metaMessage(EVENT_1));

      expect(second).toEqual({ handled: 0, ignored: 0, duplicated: 1 });
      // Una sola fila y una sola vez en la cola.
      expect(events.rows.size).toBe(1);
      expect(queuer.enqueued).toEqual([EVENT_1]);
    });
  });

  describe("redelivery tras fallo", () => {
    it("re-enquea un evento que quedó RECEIVED (nunca enqueueado)", async () => {
      // El evento quedó RECEIVED: p. ej. el proceso murió entre INSERT y enqueue.
      events.rows.set(EVENT_1, event("ev-old", EVENT_1, "RECEIVED"));

      const result = await service.ingest(metaMessage(EVENT_1));

      expect(result).toEqual({ handled: 1, ignored: 0, duplicated: 0 });
      expect(queuer.enqueued).toEqual([EVENT_1]);
      expect(events.rows.get(EVENT_1)?.status).toBe("ENQUEUED");
    });

    it("re-enquea un evento FAILED (fallo de cola previo)", async () => {
      events.rows.set(EVENT_1, event("ev-1", EVENT_1, "FAILED"));

      const result = await service.ingest(metaMessage(EVENT_1));

      expect(result).toEqual({ handled: 1, ignored: 0, duplicated: 0 });
      expect(queuer.enqueued).toEqual([EVENT_1]);
      expect(events.rows.get(EVENT_1)?.status).toBe("ENQUEUED");
    });

    it("un fallo de enqueue marca FAILED, lanza y no pierde el evento", async () => {
      queuer.failNext = true;

      await expect(service.ingest(metaMessage(EVENT_1))).rejects.toBeInstanceOf(
        ExternalProviderError,
      );

      expect(events.rows.get(EVENT_1)?.status).toBe("FAILED");
      expect(queuer.enqueued).toEqual([]);
      expect(logger.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("deduplicación por carrera", () => {
    it("si el ganador ya quedó ENQUEUED, el perdedor reporta duplicated", async () => {
      // simulate otra copia: fila insertada y ya enqueueada
      events.rows.set(EVENT_1, event("ev-win", EVENT_1, "ENQUEUED"));

      const result = await service.ingest(metaMessage(EVENT_1));

      expect(result).toEqual({ handled: 0, ignored: 0, duplicated: 1 });
      expect(queuer.enqueued).toEqual([]);
    });
  });

  describe("cuentas desconocidas", () => {
    it("ignora sin persistir nada", async () => {
      const result = await service.ingest(metaMessage(EVENT_1, PHONE_UNKNOWN));

      expect(result).toEqual({ handled: 0, ignored: 1, duplicated: 0 });
      expect(events.rows.size).toBe(0);
      expect(queuer.enqueued).toEqual([]);
    });
  });

  describe("statuses del envío", () => {
    it("ingesta también los cambios de estado (delivered/sent/read)", async () => {
      const result = await service.ingest(metaStatus(EVENT_2));

      expect(result).toEqual({ handled: 1, ignored: 0, duplicated: 0 });
      expect(events.rows.get(EVENT_2)?.eventType).toBe("status:sent");
      expect(events.rows.get(EVENT_2)?.status).toBe("ENQUEUED");
    });
  });

  describe("malformados", () => {
    it("ignora un payload sin entry", async () => {
      expect(await service.ingest(null)).toEqual(report());
      expect(await service.ingest("hola")).toEqual(report());
      expect(await service.ingest({})).toEqual(report());
      expect(await service.ingest({ entry: "no-array" })).toEqual(report());
    });

    it("ignora cambios sin phone_number_id y avisa", async () => {
      const body = {
        entry: [{ changes: [{ field: "messages", value: { messages: [{ id: EVENT_1 }] } }] }],
      };
      const result = await service.ingest(body);

      expect(result).toEqual({ handled: 0, ignored: 1, duplicated: 0 });
      expect(logger.warnings.length).toBe(1);
      expect(events.rows.size).toBe(0);
    });

    it("ignora campos que no son 'messages'", async () => {
      const body = {
        entry: [{ changes: [{ field: "account_alerts", value: { metadata: { phone_number_id: PHONE_A } } }] }],
      };
      const result = await service.ingest(body);

      expect(result).toEqual({ handled: 0, ignored: 1, duplicated: 0 });
      expect(events.rows.size).toBe(0);
    });
  });
});