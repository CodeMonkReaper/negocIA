import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class ProductIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}

