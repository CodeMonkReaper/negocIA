import type { MembershipStatus } from "../identity/statuses";
import type { Role } from "../identity/roles";

/**
 * Tenant context inmutable (docs/architecture/tenant-context.md §2).
 *
 * Se propaga por `AsyncLocalStorage` para que servicio → repositorio →
 * transacción compartan el mismo contexto sin pasarlo por cada firma.
 *
 * Reglas (§8):
 *  1. Nunca se construye desde datos no validados de la request (el cliente
 *     puede alterar headers, body o query).
 *  2. Nunca se confía en el `tenant_id` del body/query/header.
 *  3. `source = WORKER_JOB | WEBHOOK` debe validar el tenant contra BD antes
 *     de construir el contexto.
 */
export const TENANT_CONTEXT_SOURCES = [
  "HTTP_JWT",
  "WORKER_JOB",
  "WEBHOOK",
  "TOOL",
  "SYSTEM",
] as const;

export type TenantContextSource = (typeof TENANT_CONTEXT_SOURCES)[number];

export interface TenantContext {
  /** Siempre presente en operaciones tenant-scoped. */
  tenantId: string;
  /** `null` en webhooks/tools sin usuario resolvible. */
  userId: string | null;
  /** Rol del principal en el tenant activo; `null` sin usuario. */
  role: Role | null;
  /** Cómo se obtuvo el contexto. */
  source: TenantContextSource;
  /**
   * `jti` de la sesión que originó el request (`session_id` de la familia de
   * refresh tokens). Se propaga para que `logout` pueda revocar la familia
   * correcta sin depender del body.
   */
  sessionId: string | null;
}

/**
 * Identidad autenticada completa, resuelta desde PostgreSQL por request
 * (docs/architecture/authentication.md §7, ADR-005).
 *
 * El JWT aporta la *identidad*; esta estructura aporta la *autorización*.
 */
export interface Principal {
  userId: string;
  email: string;
  name: string;
  status: string;
  emailVerifiedAt: Date | null;
  sessionId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  membershipStatus: MembershipStatus | string;
  tenantStatus: string;
  tenantSlug: string;
  tenantName: string;
  tenantPlan: string;
}

export function isTenantContextSource(
  value: unknown,
): value is TenantContextSource {
  return (
    typeof value === "string" &&
    (TENANT_CONTEXT_SOURCES as readonly string[]).includes(value)
  );
}
