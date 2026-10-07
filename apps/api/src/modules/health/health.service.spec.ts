import { describe, expect, it } from "vitest";
import { HealthService } from "./health.service";
import type { DependencyProbe, DependencyStatus } from "../../domain/ports/dependency-probe";

function probe(status: DependencyStatus): DependencyProbe {
  return { check: async () => status };
}

const UP: DependencyStatus = {
  name: "postgresql",
  status: "up",
  latencyMs: 3,
};

const REDIS_UP: DependencyStatus = {
  name: "redis",
  status: "up",
  latencyMs: 1,
};

const DOWN: DependencyStatus = {
  name: "postgresql",
  status: "down",
  latencyMs: 10001,
  error: "PrismaClientInitializationError",
};

describe("HealthService", () => {
  describe("check (liveness)", () => {
    /**
     * La razón de separar liveness de readiness. Si la liveness consultara la
     * BD, una caída de PostgreSQL provocaría reinicios en bucle que no
     * arreglan nada, porque la API seguiría sin poder hablar con la base de
     * datos que sigue caída.
     */
    it("responde ok con la BD caída, sin lanzar ni sondear", async () => {
      let called = false;
      const service = new HealthService([
        {
          check: async () => {
            called = true;
            return DOWN;
          },
        },
      ]);

      const response = service.check();

      expect(response.status).toBe("ok");
      expect(response.service).toBe("negocia-api");
      expect(typeof response.timestamp).toBe("string");
      expect(typeof response.uptime).toBe("number");
      expect(called).toBe(false);
    });

    it("incluye el requestId cuando existe", () => {
      const service = new HealthService([probe(UP)]);

      expect(service.check("req-1").requestId).toBe("req-1");
      expect(service.check().requestId).toBeUndefined();
    });
  });

  describe("ready (readiness)", () => {
    it("reporta ok cuando todas las dependencias responden", async () => {
      const service = new HealthService([probe(UP), probe(REDIS_UP)]);

      const response = await service.ready("req-2");

      expect(response.status).toBe("ok");
      expect(response.dependencies).toEqual([UP, REDIS_UP]);
      expect(response.requestId).toBe("req-2");
    });

    /**
     * Este es el defecto que se corrigió: antes `check()` devolvía
     * `status: "ok"` incondicionalmente, así que una API sin base de datos se
     * anunciaba como sana y el orquestador no hacía nada al respecto.
     */
    it("reporta down cuando una dependencia no responde", async () => {
      const service = new HealthService([probe(DOWN), probe(REDIS_UP)]);

      const response = await service.ready();

      expect(response.status).toBe("down");
      expect(response.dependencies[0].status).toBe("down");
      expect(response.dependencies[0].error).toBe("PrismaClientInitializationError");
    });

    it("reporta down si cae Redis aunque PostgreSQL siga arriba", async () => {
      const service = new HealthService([
        probe(UP),
        { ...probe(REDIS_UP), check: async () => ({ ...REDIS_UP, status: "down", error: "ECONNREFUSED" }) },
      ]);

      const response = await service.ready();

      expect(response.status).toBe("down");
      expect(response.dependencies).toHaveLength(2);
    });

    it("conserva el motivo del fallo para poder diagnosticar", async () => {
      const service = new HealthService([probe(DOWN)]);

      const response = await service.ready();

      // El error está en la respuesta porque `/api/health/ready` es público:
      // la sonda solo expone la clase del error, nunca el mensaje, que puede
      // llevar la DSN con la contraseña.
      expect(response.dependencies[0].error).toBeDefined();
    });

    /**
     * `DependencyProbe` ya garantiza que no lanza, pero si esa garantía se
     * rompe el síntoma sería un 500 sin cuerpo en el endpoint encargado de
     * explicar qué está roto. Se traduce a `down` con la clase del error y sin
     * el mensaje, que puede incluir la DSN con la contraseña.
     */
    it("traduce una sonda que lanza a down, con la clase del error y no el mensaje", async () => {
      const service = new HealthService([
        {
          check: async () => {
            throw Object.assign(
              new Error("connect ECONNREFUSED postgres://user:secret@host/db"),
              { name: "PrismaClientInitializationError" },
            );
          },
        },
      ]);

      const response = await service.ready();

      expect(response.status).toBe("down");
      expect(response.dependencies[0].error).toBe("PrismaClientInitializationError");
      expect(JSON.stringify(response)).not.toContain("secret");
    });
  });
});