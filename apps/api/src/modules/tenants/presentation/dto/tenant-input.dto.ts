import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from "../../../../domain/identity/statuses";
import { ROLES, type Role } from "../../../../domain/identity/roles";

/**
 * Cuerpo del PATCH de tenant (docs/api/authentication.md §10.2).
 *
 * Se declara como clase aunque todos los campos sean opcionales porque `PATCH`
 * necesita distinguir "no enviado" (`undefined`) de `null`/vacío, y
 * `transform: true` con tipos explícitos lo hace por nosotros.
 */
export class UpdateTenantDto {
  @ApiPropertyOptional({ example: "Café de Ana", maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: "el nombre no puede quedar vacío" })
  @MaxLength(100)
  name?: string;

  /** Slug de la URL pública del tenant (`/t/{slug}`). */
  @ApiPropertyOptional({
    example: "cafe-de-ana",
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    maxLength: 60,
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "solo minúsculas, números y guiones",
  })
  @MinLength(3)
  @MaxLength(60)
  slug?: string;
}

/** Cuerpo del PATCH de usuario del tenant (docs/api/authentication.md §9.2). */
export class UpdateTenantUserDto {
  @ApiPropertyOptional({ enum: ROLES, example: "ADMIN" })
  @IsOptional()
  @IsIn(ROLES as unknown as string[])
  role?: Role;

  /** Estado de la **membresía**, no del usuario. */
  @ApiPropertyOptional({ enum: MEMBERSHIP_STATUSES, example: "ACTIVE" })
  @IsOptional()
  @IsIn(MEMBERSHIP_STATUSES)
  status?: MembershipStatus;
}