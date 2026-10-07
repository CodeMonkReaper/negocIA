import { describe, expect, it } from "vitest";
import {
  parseCustomerName,
  parseDeliveryStatusUpdates,
  parseInboundMessages,
} from "./meta-message.mapper";

const TEXT_VALUE = {
  messaging_product: "whatsapp",
  metadata: {
    display_phone_number: "573001234567",
    phone_number_id: "109251382252923",
  },
  contacts: [{ profile: { name: "María Peña" }, wa_id: "573100000001" }],
  messages: [
    {
      from: "573100000001",
      id: "wamid.HBgNMTE4MjcwNzc4",
      timestamp: "1739737230",
      type: "text",
      text: { body: "Hola, ¿tienen menú vegano?" },
    },
  ],
};

describe("parseInboundMessages", () => {
  it("extrae el mensaje de texto con contacto y wamid", () => {
    const [draft] = parseInboundMessages(TEXT_VALUE);

    expect(draft.providerMessageId).toBe("wamid.HBgNMTE4MjcwNzc4");
    expect(draft.customerWaId).toBe("573100000001");
    expect(draft.customerName).toBe("María Peña");
    expect(draft.type).toBe("text");
    expect(draft.content).toBe("Hola, ¿tienen menú vegano?");
    expect(draft.timestamp).toBe("1739737230");
    expect(draft.metadata).toEqual(TEXT_VALUE.messages[0]);
  });

  it("extrae la caption de un mensaje de imagen", () => {
    const value = {
      messages: [
        {
          from: "573100000001",
          id: "wamid.img",
          timestamp: "1739737230",
          type: "image",
          image: { id: "media-id", caption: "Foto del instalado" },
        },
      ],
    };
    const [draft] = parseInboundMessages(value);

    expect(draft.type).toBe("image");
    expect(draft.content).toBe("Foto del instalado");
  });

  it("deja content en null para mensajes sin texto (p. ej. location)", () => {
    const value = {
      messages: [
        {
          from: "573100000001",
          id: "wamid.loc",
          timestamp: "1739737230",
          type: "location",
          location: { latitude: 4.7, longitude: -74.07 },
        },
      ],
    };
    const [draft] = parseInboundMessages(value);

    expect(draft.type).toBe("location");
    expect(draft.content).toBeNull();
  });

  it("descarta mensajes sin id o sin from", () => {
    const value = {
      messages: [{ type: "text", text: { body: "sin id" } }, { id: "x" }],
    };
    expect(parseInboundMessages(value)).toHaveLength(0);
  });

  it("es total: payloads no objetos y arreglos raros devuelven listas vacías", () => {
    expect(parseInboundMessages(null)).toEqual([]);
    expect(parseInboundMessages("hola")).toEqual([]);
    expect(parseInboundMessages([])).toEqual([]);
    expect(parseInboundMessages({ messages: "no-array" })).toEqual([]);
  });
});

describe("parseCustomerName", () => {
  it("devuelve el primer nombre de perfil disponible", () => {
    expect(parseCustomerName(TEXT_VALUE)).toBe("María Peña");
  });

  it("devuelve null cuando no hay contactos o perfil", () => {
    expect(parseCustomerName({ messages: [] })).toBeNull();
    expect(parseCustomerName({ contacts: [{ wa_id: "x" }] })).toBeNull();
    expect(parseCustomerName(null)).toBeNull();
  });
});

describe("parseDeliveryStatusUpdates", () => {
  it("extrae statuses conocidos con su wamid", () => {
    const value = {
      messages: [{ from: "573100000001", id: "wamid.out", type: "text" }],
      statuses: [
        { id: "wamid.out", status: "delivered", timestamp: "1739737240" },
        { id: "wamid.out", status: "read", timestamp: "1739737255" },
      ],
    };
    expect(parseDeliveryStatusUpdates(value)).toEqual([
      { providerMessageId: "wamid.out", deliveryStatus: "delivered" },
      { providerMessageId: "wamid.out", deliveryStatus: "read" },
    ]);
  });

  it("ignora statuses que no conocemos (evolución futura de Meta)", () => {
    const value = {
      statuses: [{ id: "wamid.x", status: "snoozed" }],
    };
    expect(parseDeliveryStatusUpdates(value)).toEqual([]);
  });
});