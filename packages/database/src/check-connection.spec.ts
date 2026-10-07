import { describe, expect, it, vi } from "vitest";
import {
  checkConnection,
  type PrismaLikeConnection,
} from "./check-connection";

function stubDb(): {
  db: PrismaLikeConnection;
  $connect: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $disconnect: ReturnType<typeof vi.fn>;
} {
  const $connect = vi.fn().mockResolvedValue(undefined);
  const $queryRaw = vi.fn().mockResolvedValue([{ result: 1 }]);
  const $disconnect = vi.fn().mockResolvedValue(undefined);
  return { db: { $connect, $queryRaw, $disconnect }, $connect, $queryRaw, $disconnect };
}

describe("checkConnection", () => {
  it("devuelve las filas y desconecta al terminar", async () => {
    const { db, $connect, $queryRaw, $disconnect } = stubDb();
    await expect(checkConnection(db)).resolves.toEqual([{ result: 1 }]);
    expect($connect).toHaveBeenCalledOnce();
    expect($queryRaw).toHaveBeenCalledOnce();
    expect($disconnect).toHaveBeenCalledOnce();
  });

  it("desconecta incluso si la consulta falla (finally)", async () => {
    const { db, $queryRaw, $disconnect } = stubDb();
    const boom = new Error("query exploded");
    $queryRaw.mockRejectedValue(boom);
    await expect(checkConnection(db)).rejects.toBe(boom);
    expect($queryRaw).toHaveBeenCalled();
    expect($disconnect).toHaveBeenCalled();
  });

  it("no desconecta si nunca llegó a conectar", async () => {
    const { db, $connect, $disconnect } = stubDb();
    const boom = new Error("connection refused");
    $connect.mockRejectedValue(boom);
    await expect(checkConnection(db)).rejects.toBe(boom);
    expect($disconnect).not.toHaveBeenCalled();
  });
});