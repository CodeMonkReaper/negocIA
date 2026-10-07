import { describe, expect, it } from "vitest";
import {
  API_ERROR_CODES,
  INVITATION_STATUSES,
  MEMBERSHIP_STATUSES,
  ROLES,
  TENANT_STATUSES,
  USER_STATUSES,
  type ApiErrorCode,
} from "./index";

/**
 * Primera spec de `packages/contracts`.
 *
 * El paquete era el único del monorepo sin tests, y es precisamente el que
 * define el contrato entre backend y front: nada detectaba aquí una deriva,
 * porque los tipos solo existen en tiempo de compilación y los errores solo se
 * ven cuando un cliente recibe un código que no reconoce.
 *
 * Estos tests fijan las dos cosas que no puede fijar el compilador:
 *  1. que el vocabulario de identidades no se separe de los CHECK de la BD;
 *  2. que el catálogo de errores no se separe del dominio.
 */

/**
 * Los CHECK de `identity_core` (`migration.sql`), transcritos.
 *
 * Se escriben a mano y **no** se importan del dominio a propósito: si el test
 * comparara contra `apps/api`, `packages/contracts` necesitaría una dependencia
 * hacia el backend, que es justo lo que este paquete evita. La transcripción
 * manual es el coste de esa independencia, y este test es el que la vigila.
 */
const CHECK_CONSTRAINTS = {
  memberships_role_check: ["OWNER", "ADMIN", "AGENT"],
  memberships_status_check: ["ACTIVE", "INACTIVE"],
  users_status_check: ["ACTIVE", "DISABLED"],
  tenants_status_check: ["ACTIVE", "SUSPENDED", "CLOSED"],
  invitations_status_check: ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"],
} as const;

describe("contratos: vocabulario de identidad", () => {
  it.each(Object.entries(CHECK_CONSTRAINTS))(
    "%s coincide con la copia de wire",
    (constraint, expected) => {
      const actual = {
        memberships_role_check: ROLES,
        memberships_status_check: MEMBERSHIP_STATUSES,
        users_status_check: USER_STATUSES,
        tenants_status_check: TENANT_STATUSES,
        invitations_status_check: INVITATION_STATUSES,
      }[constraint];

      // Orden incluido: el orden de la constante y el del CHECK deben seguir
      // leyéndose igual, porque un diff de orden delata un CHECK editado a
      // mano sin actualizar el contrato.
      expect([...actual]).toEqual([...expected]);
    },
  );

  it("no declara MEMBER, que fue el valor que M-1 documentó por error", () => {
    expect(ROLES).not.toContain("MEMBER");
  });
});

describe("contratos: catálogo de errores", () => {
  it("incluye invalid_token, el código uniforme de tokens no válidos", () => {
    expect(API_ERROR_CODES).toContain("invalid_token");
  });

  it("no tiene códigos duplicados", () => {
    // Un duplicado en el array no rompe nada en runtime, pero hace que la
    // búsqueda por índice y la comparación por conjunto den resultados
    // distintos según dónde se mire.
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it("todos los códigos usan snake_case minúsculo", () => {
    for (const code of API_ERROR_CODES) {
      expect(code).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });
});

/**
 * `DomainErrorCode` del API, transcrito igual que los CHECK.
 *
 * Este es el test que faltaba: `AllExceptionsFilter` convierte el código de
 * dominio a `ApiErrorCode` con una aserción de tipo, que el compilador acepta
 * sin comprobar nada. Si un dominio ganase un error nuevo y no se añadiera al
 * catálogo compartido, el filtro devolvería un `code` que ningún cliente
 * reconoce en runtime, y el typecheck seguiría en verde.
 */
const DOMAIN_ERROR_CODES = [
  "validation_error",
  "invalid_credentials",
  "invalid_refresh_token",
  "invalid_token",
  "token_expired",
  "reuse_detected",
  "account_disabled",
  "tenant_inactive",
  "membership_inactive",
  "forbidden",
  "not_found",
  "invitation_not_found",
  "user_not_found",
  "email_already_registered",
  "already_member",
  "invitation_pending",
  "email_in_use",
  "conflict",
  "rate_limited",
  "webhook_verification_failed",
  "external_provider_error",
  "llm_error",
  "database_error",
  "internal_server_error",
  // M8.1: Embedded Signup
  "embedded_signup_invalid_state",
  "embedded_signup_token_exchange_failed",
  "embedded_signup_waba_not_found",
  "embedded_signup_no_phone_numbers",
  "embedded_signup_account_creation_failed",
  "embedded_signup_missing_params",
  "embedded_signup_denied",
] as const satisfies readonly ApiErrorCode[];

describe("contratos: paridad con el dominio", () => {
  it("el dominio no declara un código que contracts no conozca", () => {
    const missing = DOMAIN_ERROR_CODES.filter(
      (code) => !API_ERROR_CODES.includes(code),
    );

    expect(missing).toEqual([]);
  });

  it("contracts no declara un código que el dominio no emita", () => {
    // Sentido inverso a propósito. Puede legerse como "hay códigos de
    // API_ERROR_CODES sin emisor": son inocuos para el front (que los tiene
    // tipados) pero delatan un error de dominio retirado sin limpiar.
    const orphans = API_ERROR_CODES.filter(
      (code) => !DOMAIN_ERROR_CODES.includes(code as never),
    );

    expect(orphans).toEqual([]);
  });
});
