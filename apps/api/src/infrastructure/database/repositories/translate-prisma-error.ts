import { ConflictError, NotFoundError } from "../../../domain/errors";

/**
 * Traducción de errores de Prisma a errores de dominio.
 *
 * La detección es **estructural** (se lee `err.code`) en vez de
 * `instanceof Prisma.PrismaClientKnownRequestError`: con driver adapters la
 * clase de error ha cambiado entre versiones de Prisma y un `instanceof`
 * roto convertiría una violación de unicidad en un 500.
 *
 * P2002 = unique constraint violated
 * P2025 = record not found (operación `update`/`delete` sobre fila ausente)
 */
export function translatePrismaError(error: unknown, context: string): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  const code = (error as { code?: unknown }).code;

  if (code === "P2002") {
    return new ConflictError(
      "conflict",
      `Violación de unicidad en ${context}`,
      { constraint: (error as { meta?: { target?: unknown } }).meta?.target },
    );
  }

  if (code === "P2025") {
    return new NotFoundError("not_found", `Recurso no encontrado en ${context}`);
  }

  return error;
}
