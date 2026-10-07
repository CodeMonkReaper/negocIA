import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class TenantIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  tenantId!: string;
}

export class TenantUserIdParamDto extends TenantIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  userId!: string;
}