import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { CONVERSATION_ACTIONS, type ConversationAction } from "@negocia/contracts";

/**
 * Cuerpo de la transición de estado de una conversación (F6-3).
 *
 * `TAKE` reclama la conversación para un humano; `RETURN_TO_BOT` la devuelve
 * al bot. La validez respecto al estado actual la decide el servicio (404 si
 * la acción no aplica).
 */
export class TransitionConversationDto {
  @ApiProperty({ enum: CONVERSATION_ACTIONS, example: "TAKE" })
  @IsIn(CONVERSATION_ACTIONS)
  action!: ConversationAction;
}