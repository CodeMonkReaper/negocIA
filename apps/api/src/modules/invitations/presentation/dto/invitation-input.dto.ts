import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { ROLES, type Role } from "../../../../domain/identity/roles";

/**
 * DTOs de entrada de invitaciones y verificación de email
 * (docs/api/authentication.md §7-§8).
 *
 * Se quedan en `apps/api` a diferencia de los de respuesta: dependen de
 * `class-validator` y de los decorators de Swagger, y moverlos a
 * `@negocia/contracts` obligaría al front a arrastrar la validación del
 * servidor para tipar un formulario.
 */

export class CreateInvitationDto {
  @ApiProperty({ example: "pedro@example.com", maxLength: 320 })
  // Mismo `@Transform` que en `RegisterDto`: `normalizeEmail` normaliza en el
  // dominio, y un email con espacios no puede fallar solo en el borde.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /**
   * Rol propuesto. El formato acepta cualquier rol del CHECK; la regla de
   * autorización la aplica el servicio con la matriz de `roles.ts`
   * (`canInviteRole`): un ADMIN no puede invitar a OWNER, solo un OWNER puede.
   * El controller igualmente está restringido a `@Roles(OWNER, ADMIN)`.
   */
  @ApiProperty({ enum: ROLES, example: "AGENT" })
  @IsIn(ROLES as unknown as string[])
  role!: Role;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: "Token opaco recibido por email." })
  @IsString()
  // Sin `@Length`: el token es opaco y su longitud es responsabilidad del
  // generador, no del cliente. Acotarlo aquí solo rechazaría tokens válidos
  // si el generador cambiara.
  @IsNotEmpty()
  token!: string;
}

export class VerifyEmailTokenDto {
  @ApiProperty({ description: "Token opaco recibido por email." })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class InvitationIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}
