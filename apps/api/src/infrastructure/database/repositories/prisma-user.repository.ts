import { Injectable } from "@nestjs/common";
import { type Prisma, type PrismaClient } from "@negocia/database";
import type {
  CreateUserInput,
  UserRecord,
} from "../../../domain/identity/entities";
import type { UserRepository } from "../../../domain/ports/user-repository";
import { translatePrismaError } from "./translate-prisma-error";

/**
 * Cliente Prisma o cliente de transacción: los repositorios se construyen
 * indistintamente con uno u otro (el `UnitOfWork` les pasa el segundo).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

export function toUserRecord(row: {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? toUserRecord(row) : null;
  }

  /**
   * Búsqueda case-insensitive.
   *
   * La aplicación normaliza a minúsculas, así que la igualdad simple bastaría;
   * se usa `mode: "insensitive"` porque es el modo que puede aprovechar el
   * índice `users_email_lower_idx` (fallback de `citext`, migración
   * `identity_core`), y porque hace el login inmune a filas con mayúsculas
   * insertadas por fuera de la aplicación.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    return row ? toUserRecord(row) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    try {
      const row = await this.db.user.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
          ...(input.status ? { status: input.status } : {}),
        },
      });
      return toUserRecord(row);
    } catch (error) {
      // P2002 (email duplicado) se traduce a 409: la carrera entre dos
      // registros simultáneos con el mismo email se resuelve aquí.
      throw translatePrismaError(error, "users.create");
    }
  }

  async markEmailVerified(userId: string, at: Date): Promise<UserRecord> {
    const row = await this.db.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: at },
    });
    return toUserRecord(row);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<UserRecord> {
    const row = await this.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return toUserRecord(row);
  }
}
