import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { ListResponse, ProductResponseDto } from "@negocia/contracts";
import type { Request } from "express";
import { Roles } from "../../../common/guards/roles.decorator";
import type { Principal } from "../../../domain/tenant-context";
import { CatalogService } from "../application/catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { ListProductsQueryDto } from "./dto/list-products-query.dto";
import { ProductIdParamDto } from "./dto/product-param.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { toProductResponseDto } from "./product.mapper";

@ApiTags("catalog")
@ApiBearerAuth()
@Controller("products")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Roles("OWNER", "ADMIN", "AGENT")
  @ApiOperation({ summary: "Listar productos y servicios del tenant" })
  @ApiResponse({ status: 200, description: "Lista paginada de productos." })
  async list(
    @Query() query: ListProductsQueryDto,
    @Req() request: Request,
  ): Promise<ListResponse<ProductResponseDto>> {
    const principal = request.principal as Principal;
    const { items, total } = await this.catalog.listProducts(
      principal.tenantId,
      {
        type: query.type,
        status: query.status,
        search: query.search,
        limit: query.limit,
        offset: query.offset,
      },
    );
    return {
      items: items.map(toProductResponseDto),
      total,
    };
  }

  @Get(":id")
  @Roles("OWNER", "ADMIN", "AGENT")
  @ApiOperation({ summary: "Obtener un producto o servicio por ID" })
  @ApiResponse({ status: 200, description: "Detalle del producto." })
  @ApiResponse({ status: 404, description: "Producto no encontrado." })
  async get(
    @Param() params: ProductIdParamDto,
    @Req() request: Request,
  ): Promise<ProductResponseDto> {
    const principal = request.principal as Principal;
    const item = await this.catalog.getProduct(principal.tenantId, params.id);
    return toProductResponseDto(item);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles("OWNER", "ADMIN")
  @ApiOperation({ summary: "Crear un nuevo producto o servicio" })
  @ApiResponse({ status: 201, description: "Producto creado exitosamente." })
  @ApiResponse({ status: 409, description: "Límite del plan superado." })
  async create(
    @Body() body: CreateProductDto,
    @Req() request: Request,
  ): Promise<ProductResponseDto> {
    const principal = request.principal as Principal;
    const created = await this.catalog.createProduct(principal.tenantId, body);
    return toProductResponseDto(created);
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  @Roles("OWNER", "ADMIN")
  @ApiOperation({ summary: "Actualizar un producto o servicio existente" })
  @ApiResponse({ status: 200, description: "Producto actualizado." })
  @ApiResponse({ status: 404, description: "Producto no encontrado." })
  async update(
    @Param() params: ProductIdParamDto,
    @Body() body: UpdateProductDto,
    @Req() request: Request,
  ): Promise<ProductResponseDto> {
    const principal = request.principal as Principal;
    const updated = await this.catalog.updateProduct(
      principal.tenantId,
      params.id,
      body,
    );
    return toProductResponseDto(updated);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles("OWNER", "ADMIN")
  @ApiOperation({ summary: "Eliminar un producto o servicio" })
  @ApiResponse({ status: 204, description: "Producto eliminado." })
  @ApiResponse({ status: 404, description: "Producto no encontrado." })
  async delete(
    @Param() params: ProductIdParamDto,
    @Req() request: Request,
  ): Promise<void> {
    const principal = request.principal as Principal;
    await this.catalog.deleteProduct(principal.tenantId, params.id);
  }
}

