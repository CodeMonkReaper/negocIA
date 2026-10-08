import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type ProductStatus,
  type ProductType,
} from "@negocia/contracts";

export class ListProductsQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  type?: ProductType;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

