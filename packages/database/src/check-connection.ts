/**
 * Verifica la conexión a PostgreSQL ejecutando `SELECT 1`.
 *
 * Extraído del script `db:check` para poder testearlo con un stub (que no
 * abra red). El `$disconnect` corre en `finally`, así que también libera la
 * conexión cuando la consulta falla.
 */
export interface PrismaLikeConnection {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

export async function checkConnection<T = Array<{ result: number }>>(
  db: PrismaLikeConnection,
): Promise<T> {
  await db.$connect();
  try {
    return await db.$queryRaw<T>`SELECT 1 AS result`;
  } finally {
    await db.$disconnect();
  }
}