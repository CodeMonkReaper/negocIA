import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { closeTestDatabase, resetDatabase } from "./helpers/database";
import { testUrl } from "./helpers/env";

const PASSWORD = "Password1234!";

function api(path: string): string {
  return `/api/v1${path}`;
}

let app: INestApplication;
let http: Server;
let prisma: PrismaService;

interface SessionBody {
  accessToken: string;
  tenant: { id: string; name: string };
  user: { id: string; email: string };
}

async function register(email: string, name: string): Promise<SessionBody> {
  const res = await request(http)
    .post(api("/auth/register"))
    .send({ name, email, password: PASSWORD });
  expect(res.status).toBe(201);
  return res.body as SessionBody;
}

function bearer(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("Catalog endpoints (e2e)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe("POST /products", () => {
    it("exige sesión (401 sin token)", async () => {
      const res = await request(http)
        .post(api("/products"))
        .send({ name: "Café", price: 2000 });
      expect(res.status).toBe(401);
    });

    it("crea un producto para OWNER y devuelve 201", async () => {
      const owner = await register("barista@example.com", "Barista");

      const res = await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({
          name: "Cappuccino Italiano",
          description: "Con leche texturizada",
          price: 3500,
          currency: "CLP",
          type: "PRODUCT",
          category: "Cafetería",
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: "Cappuccino Italiano",
        price: 3500,
        currency: "CLP",
        type: "PRODUCT",
        status: "ACTIVE",
      });
      expect(res.body.id).toBeTruthy();
    });

    it("valida el body (400 si falta el nombre o el precio)", async () => {
      const owner = await register("owner@example.com", "Owner");

      const res = await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({ price: 3500 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation_error");
    });
  });

  describe("GET /products", () => {
    it("lista productos filtrando por el tenant autenticado", async () => {
      const ownerA = await register("tenant-a@example.com", "Tenant A");
      const ownerB = await register("tenant-b@example.com", "Tenant B");

      await request(http)
        .post(api("/products"))
        .set(...bearer(ownerA.accessToken))
        .send({ name: "Producto A", price: 1000 });

      await request(http)
        .post(api("/products"))
        .set(...bearer(ownerB.accessToken))
        .send({ name: "Producto B", price: 2000 });

      const resA = await request(http)
        .get(api("/products"))
        .set(...bearer(ownerA.accessToken));

      expect(resA.status).toBe(200);
      expect(resA.body.items).toHaveLength(1);
      expect(resA.body.items[0].name).toBe("Producto A");
    });

    it("permite filtrar por búsqueda y tipo", async () => {
      const owner = await register("filtro@example.com", "Owner");

      await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({ name: "Corte de pelo", price: 10000, type: "SERVICE" });

      await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({ name: "Cera modeladora", price: 8000, type: "PRODUCT" });

      const res = await request(http)
        .get(api("/products?type=SERVICE&search=corte"))
        .set(...bearer(owner.accessToken));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe("Corte de pelo");
    });
  });

  describe("GET /products/:id", () => {
    it("devuelve 404 para un producto de otro tenant", async () => {
      const ownerA = await register("a@example.com", "Owner A");
      const ownerB = await register("b@example.com", "Owner B");

      const created = await request(http)
        .post(api("/products"))
        .set(...bearer(ownerA.accessToken))
        .send({ name: "Secreto A", price: 5000 });

      const res = await request(http)
        .get(api(`/products/${created.body.id}`))
        .set(...bearer(ownerB.accessToken));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
    });

    it("devuelve 400 con un UUID inválido", async () => {
      const owner = await register("uuid@example.com", "Owner");
      const res = await request(http)
        .get(api("/products/no-es-uuid"))
        .set(...bearer(owner.accessToken));
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /products/:id", () => {
    it("actualiza datos del producto", async () => {
      const owner = await register("patch@example.com", "Owner");

      const created = await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({ name: "Antes", price: 5000 });

      const res = await request(http)
        .patch(api(`/products/${created.body.id}`))
        .set(...bearer(owner.accessToken))
        .send({ name: "Después", price: 6000 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Después");
      expect(res.body.price).toBe(6000);
    });
  });

  describe("DELETE /products/:id", () => {
    it("elimina el producto y devuelve 204", async () => {
      const owner = await register("del@example.com", "Owner");

      const created = await request(http)
        .post(api("/products"))
        .set(...bearer(owner.accessToken))
        .send({ name: "A borrar", price: 5000 });

      const res = await request(http)
        .delete(api(`/products/${created.body.id}`))
        .set(...bearer(owner.accessToken));

      expect(res.status).toBe(204);

      const check = await request(http)
        .get(api(`/products/${created.body.id}`))
        .set(...bearer(owner.accessToken));
      expect(check.status).toBe(404);
    });
  });
});

