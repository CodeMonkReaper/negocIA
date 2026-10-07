import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * Alta manual de una cuenta de WhatsApp (Embedded Signup diferido a M8).
 *
 * Los ids de Meta (`waba_id`, `phone_number_id`) son numéricos; el token de
 * acceso del WABA es una cadena larga. Ninguno se devuelve después del alta
 * (ver el mapper): el token se guarda, no se refleja.
 */
export class CreateWhatsappAccountDto {
  @ApiProperty({ example: "1234567890", description: "id del WhatsApp Business Account (WABA)" })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: "el WABA id es numérico" })
  @MinLength(1)
  @MaxLength(40)
  wabaId!: string;

  @ApiProperty({ example: "573001234567", description: "id del número de teléfono dentro del WABA" })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: "el phone_number_id es numérico" })
  @MinLength(1)
  @MaxLength(40)
  phoneNumberId!: string;

  @ApiPropertyOptional({ example: "573001234567", description: "número en formato de visualización" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayPhone?: string;

  @ApiProperty({
    example: "EAAJv...",
    description: "token de acceso permanente del WABA (se guarda, nunca se devuelve)",
    minLength: 8,
    maxLength: 512,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: "el token es sospechosamente corto" })
  @MaxLength(512)
  accessToken!: string;
}