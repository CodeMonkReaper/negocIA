import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * Cuerpo del envío de un mensaje de texto al cliente (M8).
 *
 * Límite de 4096 caracteres: el máximo de un mensaje de texto de WhatsApp.
 */
export class SendMessageDto {
  @ApiProperty({ example: "Hola, sí tenemos menú vegano.", maxLength: 4096 })
  @IsString()
  @MinLength(1, { message: "el texto no puede estar vacío" })
  @MaxLength(4096, { message: "el texto supera los 4096 caracteres de WhatsApp" })
  text!: string;
}