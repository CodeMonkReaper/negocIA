import { Module } from "@nestjs/common";
import { PRODUCT_REPOSITORY } from "../../common/di-tokens";
import { LimitsService } from "../../domain/plans/limits-service";
import { PrismaProductRepository } from "../../infrastructure/database/repositories/prisma-product.repository";
import { TenantsModule } from "../tenants/tenants.module";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { CatalogService } from "./application/catalog.service";
import { CatalogController } from "./presentation/catalog.controller";

@Module({
  imports: [TenantsModule],
  controllers: [CatalogController],
  providers: [
    {
      provide: PrismaProductRepository,
      useFactory: (prisma: PrismaService) => new PrismaProductRepository(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: PRODUCT_REPOSITORY,
      useExisting: PrismaProductRepository,
    },
    LimitsService,
    CatalogService,
  ],
  exports: [CatalogService, PRODUCT_REPOSITORY],
})
export class CatalogModule {}

