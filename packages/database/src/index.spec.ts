import { beforeEach, describe, expect, it, vi } from "vitest";

// El constructor real de PrismaClient (generado, enorme) se desborda bajo la
// transformación de vitest; el factory no hace más que encadenar
// `new PrismaPg(url)` → `new PrismaClient({ adapter })`, así que los mocks
// permiten verificar exactamente esa transmisión sin necesidad de una BD.
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("./generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

import { PrismaPg } from "@prisma/adapter-pg";
import {
  createPrismaClient,
  DEFAULT_DATABASE_URL,
  PrismaClient,
} from "./index";

const prismaPgMock = vi.mocked(PrismaPg);
const prismaClientMock = vi.mocked(PrismaClient);

beforeEach(() => {
  prismaPgMock.mockClear();
  prismaClientMock.mockClear();
  // Función real (no arrow) para que `new PrismaClient()` sea válido y cree
  // una instancia nueva por llamada.
  prismaClientMock.mockImplementation(function () {
    return {};
  });
});

describe("createPrismaClient", () => {
  it("define una URL por defecto razonable para desarrollo local", () => {
    expect(DEFAULT_DATABASE_URL).toMatch(/^postgresql:\/\//);
    expect(DEFAULT_DATABASE_URL).toContain("@localhost:5432/negocia");
  });

  it("construye PrismaPg con la URL explícita y el cliente con ese adapter", () => {
    const client = createPrismaClient(DEFAULT_DATABASE_URL);
    expect(prismaPgMock).toHaveBeenCalledWith({
      connectionString: DEFAULT_DATABASE_URL,
    });
    expect(prismaClientMock).toHaveBeenCalledTimes(1);
    const adapter = prismaPgMock.mock.results[0]?.value;
    expect(prismaClientMock).toHaveBeenCalledWith({ adapter });
    expect(client).toBeDefined();
  });

  it("lee DATABASE_URL del entorno si no recibe URL", () => {
    const original = process.env.DATABASE_URL;
    const url = "postgresql://custom:secret@db.example:5432/x";
    process.env.DATABASE_URL = url;
    try {
      expect(createPrismaClient()).toBeDefined();
      expect(prismaPgMock).toHaveBeenCalledWith({ connectionString: url });
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    }
  });

  it("es una factory: cada llamada devuelve una instancia nueva", () => {
    expect(createPrismaClient()).not.toBe(createPrismaClient());
  });
});