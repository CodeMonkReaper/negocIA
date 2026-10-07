import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  CONVERSATION_STATUSES,
  type ConversationStatus,
} from "../../../../domain/conversations/entities";

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    enum: CONVERSATION_STATUSES,
    description: "Filtra por estado de la máquina de estados.",
  })
  @IsOptional()
  @IsEnum(CONVERSATION_STATUSES)
  status?: ConversationStatus;
}