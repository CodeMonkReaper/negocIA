import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "../../../domain/errors";
import {
  createInMemoryScope,
  makeMembership,
  makeTenant,
  makeUser,
  InMemoryUnitOfWork,
  type InMemoryScope,
} from "../../../testing/in-memory/fakes";
import {
  TenantUsersService,
} from "./tenant-users.service";

/**
 * El servicio lee roles y estados del objetivo desde la transacción, y la
 * invariante del último OWNER dentro de la misma transacción que la escritura:
 * la concurrencia de dos degradaciones simultáneas no se puede probar con un
 * doble en memoria (no hay filas bloqueables), así que vive en el test de
 * integración con PostgreSQL. Este archivo cubre las reglas de nivel y el
 * conteo del último OWNER en el caso secuencial.
 */
describe("TenantUsersService", () => {
  let scope: InMemoryScope;
  let service: TenantUsersService;

  const TENANT = "tenant-1";
  const OWNER = "user-owner";
  const ADMIN = "user-admin";
  const AGENT = "user-agent";

  beforeEach(() => {
    scope = createInMemoryScope();
    scope.tenants.rows.push(makeTenant({ id: TENANT }));
    // Se siembran todos los miembros directo en el array para que `listByTenant`
    // y `countActiveOwners` cuenten exactamente estos.
    scope.memberships.rows.push(
      makeMembership({ id: "m-owner", tenantId: TENANT, userId: OWNER, role: "OWNER" }),
      makeMembership({ id: "m-admin", tenantId: TENANT, userId: ADMIN, role: "ADMIN" }),
      makeMembership({ id: "m-agent", tenantId: TENANT, userId: AGENT, role: "AGENT" }),
    );
    scope.users.rows.push(
      makeUser({ id: OWNER }),
      makeUser({ id: ADMIN }),
      makeUser({ id: AGENT }),
    );

    service = new TenantUsersService(new InMemoryUnitOfWork(scope));
  });

  describe("listUsers", () => {
    it("devuelve todos los miembros del tenant con su usuario", async () => {
      const members = await service.listUsers(TENANT);

      expect(members).toHaveLength(3);
      expect(members.map((m) => m.role).sort()).toEqual([
        "ADMIN",
        "AGENT",
        "OWNER",
      ]);
      // La proyección del usuario incluye `createdAt` (necesario para
      // `TenantUserDto`).
      for (const member of members) {
        expect(member.user.id).toBe(member.userId);
        expect(member.user.createdAt).toBeInstanceOf(Date);
      }
    });
  });

  describe("updateUser: permisos (quién puede tocar a quién)", () => {
    it("OWNER puede cambiar el rol de un ADMIN", async () => {
      const result = await service.updateUser({
        tenantId: TENANT,
        targetUserId: ADMIN,
        actorUserId: OWNER,
        actorRole: "OWNER",
        role: "AGENT",
      });

      expect(result).toMatchObject({ userId: ADMIN, role: "AGENT" });

      const member = await scope.memberships.findByTenantAndUser(TENANT, ADMIN);
      expect(member?.role).toBe("AGENT");
    });

    it("ADMIN puede gestionar a otro ADMIN (mismo nivel)", async () => {
      const actorId = ADMIN;
      scope.memberships.rows.push(
        makeMembership({
          id: "m-admin2",
          tenantId: TENANT,
          userId: "user-admin2",
          role: "ADMIN",
        }),
      );

      const result = await service.updateUser({
        tenantId: TENANT,
        targetUserId: "user-admin2",
        actorUserId: actorId,
        actorRole: "ADMIN",
        role: "AGENT",
      });

      expect(result.role).toBe("AGENT");
    });

    it("ADMIN no puede tocar a un OWNER → 403", async () => {
      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: ADMIN,
        actorRole: "ADMIN",
        role: "AGENT",
      });

      await expect(attempt).rejects.toBeInstanceOf(AuthorizationError);
      await expect(attempt).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("updateUser: invariante del último OWNER", () => {
    it("degrada al OWNER si hay otro OWNER activo", async () => {
      scope.memberships.rows.push(
        makeMembership({
          id: "m-owner2",
          tenantId: TENANT,
          userId: "user-owner2",
          role: "OWNER",
        }),
      );

      const result = await service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: "user-owner2",
        actorRole: "OWNER",
        role: "AGENT",
      });

      expect(result.role).toBe("AGENT");
    });

    it("rechaza degradar al último OWNER por rol → 409", async () => {
      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: OWNER,
        actorRole: "OWNER",
        role: "AGENT",
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictError);
      await expect(attempt).rejects.toMatchObject({ code: "conflict" });

      // La transacción no dejó escrituras parciales.
      const member = await scope.memberships.findByTenantAndUser(TENANT, OWNER);
      expect(member?.role).toBe("OWNER");
    });

    it("rechaza desactivar al último OWNER por estado → 409", async () => {
      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: OWNER,
        actorRole: "OWNER",
        status: "INACTIVE",
      });

      await expect(attempt).rejects.toMatchObject({
        code: "conflict",
        details: { owners: 1 },
      });
    });

    it("permite degradar y desactivar a la vez si hay 2 OWNER", async () => {
      scope.memberships.rows.push(
        makeMembership({
          id: "m-owner2",
          tenantId: TENANT,
          userId: "user-owner2",
          role: "OWNER",
        }),
      );

      const result = await service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: "user-owner2",
        actorRole: "OWNER",
        role: "ADMIN",
        status: "INACTIVE",
      });

      expect(result).toMatchObject({ role: "ADMIN", status: "INACTIVE" });
    });

    it("el conteo cuenta OWNER activos: un OWNER INACTIVE no protege", async () => {
      scope.memberships.rows.push(
        makeMembership({
          id: "m-owner2",
          tenantId: TENANT,
          userId: "user-owner2",
          role: "OWNER",
          status: "INACTIVE",
        }),
      );

      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: OWNER,
        actorUserId: OWNER,
        actorRole: "OWNER",
        role: "ADMIN",
      });

      await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    });
  });

  describe("updateUser: errores y bordes", () => {
    it("objetivo fuera del tenant → user_not_found", async () => {
      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: "user-de-otro-tenant",
        actorUserId: OWNER,
        actorRole: "OWNER",
        role: "AGENT",
      });

      await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
      await expect(attempt).rejects.toMatchObject({ code: "user_not_found" });
    });

    it("PATCH vacío → 409", async () => {
      const attempt = service.updateUser({
        tenantId: TENANT,
        targetUserId: ADMIN,
        actorUserId: OWNER,
        actorRole: "OWNER",
      });

      await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    });

    it("cambio de estado sin cambio de rol no se compara contra el conteo", async () => {
      const result = await service.updateUser({
        tenantId: TENANT,
        targetUserId: ADMIN,
        actorUserId: OWNER,
        actorRole: "OWNER",
        status: "INACTIVE",
      });

      expect(result).toMatchObject({ userId: ADMIN, status: "INACTIVE" });
      const member = await scope.memberships.findByTenantAndUser(TENANT, ADMIN);
      expect(member?.status).toBe("INACTIVE");
    });
  });
});