import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers/app";

/**
 * Liveness y readiness sobre la app real.
 *
 * El punto de estos tests es el contrato HTTP, no `HealthService` (que ya
 * está cubierto en unitario). Concremente: la ruta neutra de versión, el 503
 * real de readiness y que la liveness no dependa de la base de datos.
 */
describe("Health (e2e)", () => {
  let app: INestApplication;
  let http: Server;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/health (liveness)", () => {
    it("responde 200 con el contrato de siempre", async () => {
      const response = await request(http).get("/api/health").expect(200);

      expect(response.body).toMatchObject({
        status: "ok",
        service: "negocia-api",
      });
      expect(typeof response.body.timestamp).toBe("string");
      expect(typeof response.body.uptime).toBe("number");
    });

    /**
     * La URL no puede llevar `/v1` aunque el versioning URI esté activo: está
     * publicada en el `.env` del front (`/api` + `/health`), en el README y en
     * el status panel. Si cambia, el front muestra "error" sin que nadie haya
     * tocado el front.
     */
    it("no está versionada", async () => {
      await request(http).get("/api/health").expect(200);
      await request(http).get("/api/v1/health").expect(404);
    });

    it("es pública: un probe no puede exigir token", async () => {
      await request(http).get("/api/health").expect(200);
    });
  });

  describe("GET /api/health/ready (readiness)", () => {
    it("responde 200 y reporta PostgreSQL y Redis arriba", async () => {
      const response = await request(http).get("/api/health/ready").expect(200);

      expect(response.body.status).toBe("ok");
      expect(response.body.dependencies).toHaveLength(2);
      expect(response.body.dependencies[0]).toMatchObject({
        name: "postgresql",
        status: "up",
      });
      expect(response.body.dependencies[1]).toMatchObject({
        name: "redis",
        status: "up",
      });
      expect(typeof response.body.dependencies[0].latencyMs).toBe("number");
      expect(typeof response.body.dependencies[1].latencyMs).toBe("number");
    });

    it("tampoco está versionada", async () => {
      await request(http).get("/api/health/ready").expect(200);
      await request(http).get("/api/v1/health/ready").expect(404);
    });
  });
});
