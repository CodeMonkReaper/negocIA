import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { PRODUCT_TYPES, type ProductType } from "@negocia/contracts";

export class CreateProductDto {
  @ApiProperty({ example: "Corte de pelo clásico" })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: "Incluye lavado y peinado" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ example: 12000 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: "CLP", default: "CLP" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES, default: "PRODUCT" })
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
}

