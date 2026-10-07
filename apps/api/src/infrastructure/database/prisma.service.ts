import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@negocia/database";

export interface PrismaServiceOptions {
  /**
   * Connection string explícito. Si se omite se usa `DATABASE_URL` del
   * entorno, igual que el resto del sistema.
   *
   * Existe para que los tests de integración puedan apuntar a un schema
   * aislado sin depender del orden de import de los módulos.
   */
  connectionString?: string;
}

/**
 * Envoltura de ciclo de vida sobre `PrismaClient`.
 *
 * Prisma 7 con `@prisma/adapter-pg` no hace pool implícito por cliente en el
 * mismo sentido que el motor Rust: es el `pg.Pool` del adapter quien decide
 * el tamaño, y ese pool es interno al adapter. Por eso este servicio **no**
 * fija `connection_limit` y se limita a exponer un punto único de conexión y
 * cierre ordenados.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(options: PrismaServiceOptions = {}) {
    this.client = createPrismaClient(options.connectionString);
  }

  get db(): PrismaClient {
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
