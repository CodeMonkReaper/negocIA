import { beforeEach, describe, expect, it, vi } from "vitest";

// El constructor real de PrismaClient (generado, enorme) se desborda bajo la
// transformación de vitest; el factory no hace más que encadenar
// `new PrismaPg(url)` → `new PrismaClient({ adapter })`, así que los mocks
// permiten verificar exactamente esa transmisión sin necesidad de una BD.
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("./generated/prisma/client", () => ({ PrismaClient: vi.fn() }));

import { PrismaPg } from "@prisma/adapter-pg";
import {
  connectionStringWithSearchPath,
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

  it("construye PrismaPg con search_path forzado y schema explícito para el engine", () => {
    const client = createPrismaClient(DEFAULT_DATABASE_URL);
    expect(prismaPgMock).toHaveBeenCalledWith(
      {
        connectionString: `postgresql://negocia:negocia@localhost:5432/negocia?schema=public&options=${encodeURIComponent("-csearch_path=public")}`,
      },
      { schema: "public" },
    );
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
      expect(prismaPgMock).toHaveBeenCalledWith({ connectionString: url }, undefined);
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

describe("connectionStringWithSearchPath", () => {
  it("traduce el ?schema= de la URL a un parámetro de arranque -csearch_path", () => {
    const result = connectionStringWithSearchPath(
      "postgresql://user:pass@localhost:5432/negocia?schema=negocia_test",
    );
    expect(result).toContain("schema=negocia_test");
    expect(new URL(result).searchParams.get("options")).toBe("-csearch_path=negocia_test");
  });

  it("deja la URL intacta si no trae ?schema=", () => {
    const url = "postgresql://user:pass@localhost:5432/negocia";
    expect(connectionStringWithSearchPath(url)).toBe(url);
  });

  it("respeta un options ya presente (no lo pisa)", () => {
    const url = "postgresql://u:p@h:5432/db?schema=otro&options=-csearch_path=custom";
    expect(connectionStringWithSearchPath(url)).toBe(url);
  });

  it("rechaza un nombre de schema que no sea identificador simple", () => {
    expect(() =>
      connectionStringWithSearchPath(
        "postgresql://u:p@h:5432/db?schema=negocia%3Bdrop",
      ),
    ).toThrow(/inválido/);
  });

  it("aplica el search_path también cuando la URL trae credenciales con caracteres especiales", () => {
    const result = connectionStringWithSearchPath(
      "postgresql://user:p%40ss@localhost:5432/negocia?schema=negocia_test",
    );
    const parsed = new URL(result);
    expect(parsed.password).toBe("p%40ss");
    expect(parsed.searchParams.get("options")).toBe("-csearch_path=negocia_test");
  });
});