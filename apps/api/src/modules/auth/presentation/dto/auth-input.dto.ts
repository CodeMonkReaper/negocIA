import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * DTOs de entrada con las reglas del dominio reflejadas en la capa HTTP.
 *
 * Se validan en el borde (contrato) y de nuevo en el dominio (regla de
 * negocio). La duplicación es intencionada: el dominio no depende de que
 * exista un DTO, y el borde puede evolucionar sin reescribir reglas. Ambas
 * capas usan los mismos límites para que no haya un contrato que acepte lo que
 * la política rechaza.
 */
export class RegisterDto {
  @ApiProperty({ example: "Ana Torres", minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: "ana@example.com", maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    example: "Correcta1!Bote",
    minLength: 12,
    maxLength: 72,
    description:
      "12-72 caracteres, mayúscula, minúscula, número y símbolo. Límite 72 por interoperabilidad con bcrypt/Argon2.",
  })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: "ana@example.com" })
  // El mismo `@Transform` que en el registro: `normalizeEmail` normaliza en el
  // dominio, así que un email con espacios no puede fallar solo en el borde.
  // De lo contrario " Ana@Example.com " daría 400 en login y 201 en register
  // para la misma cuenta, que es la peor forma de inconsistir un contrato.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "Correcta1!Bote" })
  @IsString()
  @IsNotEmpty()
  // Sin `@MinLength` aquí a propósito: la longitud mínima solo aplica al
  // registro. En login, un password corto no se distingue del equivocado.
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: "Refresh token opaco emitido en el login." })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "ana@example.com" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: "Token opaco recibido por email (15 min, 1-uso)." })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    example: "Correcta1!Bote",
    minLength: 12,
    maxLength: 72,
    description:
      "Mismas reglas que en el registro: 12-72 caracteres con mayúscula, minúscula, número y símbolo.",
  })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  newPassword!: string;
}

export class SwitchTenantDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  tenantId!: string;
}

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      "Opcional y sin efecto de autorizacion: la familia se cierra por el `jti` del access token.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  refreshToken?: string;
}
