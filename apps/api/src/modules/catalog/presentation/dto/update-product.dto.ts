import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type ProductStatus,
  type ProductType,
} from "@negocia/contracts";

export class UpdateProductDto {
  @ApiPropertyOptional({ example: "Corte de pelo clásico" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: "Incluye lavado y peinado" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: "CLP" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  type?: ProductType;

  @ApiPropertyOptional({ example: "Peluquería" })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string | null;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  durationMinutes?: number | null;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

