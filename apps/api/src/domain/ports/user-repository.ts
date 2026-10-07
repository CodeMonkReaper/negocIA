import type { CreateUserInput, UserRecord } from "../identity/entities";

/**
 * Puerto de acceso a `users` (tabla global, no tenant-scoped).
 *
 * Regla de la casa: los repositorios nunca reciben un `tenantId` para filtrar.
 * Un usuario pertenece a N tenants a través de `memberships`; el aislamiento
 * se aplica en la consulta, no en la capa de datos.
 */
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  markEmailVerified(userId: string, at: Date): Promise<UserRecord>;
  updatePassword(userId: string, passwordHash: string): Promise<UserRecord>;
}
