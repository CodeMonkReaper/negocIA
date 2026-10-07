import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type {
  CurrentTenantDto,
  ListResponse,
  TenantUserDto,
  UpdateTenantUserResponseDto,
} from "@negocia/contracts";
import type { Request } from "express";
import { NotFoundError } from "../../../domain/errors";
import type { Principal } from "../../../domain/tenant-context";
import { Roles } from "../../../common/guards/roles.decorator";
import { TenantService } from "../application/tenant.service";
import { TenantUsersService } from "../application/tenant-users.service";
import { toCurrentTenantDto } from "./tenant.mapper";
import {
  UpdateTenantDto,
  UpdateTenantUserDto,
} from "./dto/tenant-input.dto";
import {
  TenantIdParamDto,
  TenantUserIdParamDto,
} from "./dto/tenant-param.dto";
import { toTenantUserDto, toUpdateTenantUserDto } from "./tenant.mapper";

/**
 * Usuarios y metadatos del tenant activo (docs/api/authentication.md §9–§10).
 *
 * `:tenantId` de la URL se compara contra el tenant del `Principal` y **nunca**
 * se confía en él para seleccionar filas: ningún usuario debe poder leer un
 * tenant ajeno poniendo un id ajeno en la URL. La comparación devuelve 404
 * (idéntico al "no existe") para no revelar la existencia de otros tenants.
 *
 * Los dos ejes de autorización viven en sitios distintos y deliberados:
 *  - `GET /users` no lleva `@Roles`: cualquier miembro activo puede ver la
 *    lista (es la agenda del equipo).
 *  - `PATCH /users` lleva `@Roles("ADMIN")`: jerárquico, deja pasar ADMIN y
 *    OWNER; qué puede tocar cada uno lo resuelve el servicio leyendo el rol del
 *    **objetivo** de BD, no el del guard.
 *  - `PATCH /current` lleva `@Roles("OWNER")`: solo el propietario edita los
 *    metadatos del negocio.
 */
@ApiTags("tenants")
@ApiBearerAuth()
@Controller("tenants")
export class TenantsController {
  constructor(
    private readonly tenants: TenantService,
    private readonly tenantUsers: TenantUsersService,
  ) {}

  @Get("current")
  @ApiOperation({
    summary: "Tenant activo",
    description:
      "Cualquier miembro activo. Devuelve los metadatos del tenant del access token, no del path.",
  })
  @ApiResponse({ status: 200, description: "Metadatos del tenant activo." })
  async current(@Req() request: Request): Promise<CurrentTenantDto> {
    const principal = request.principal as Principal;
    const tenant = await this.tenants.getCurrent(principal.tenantId);
    return toCurrentTenantDto(tenant);
  }

  @Patch("current")
  @Roles("OWNER")
  @ApiOperation({
    summary: "Editar tenant",
    description:
      "Solo OWNER. Edita name y slug; plan y status no son editables por el inquilino.",
  })
  @ApiResponse({ status: 200, description: "Metadatos del tenant actualizados." })
  @ApiResponse({ status: 409, description: "El slug ya existe." })
  async updateCurrent(
    @Body() body: UpdateTenantDto,
    @Req() request: Request,
  ): Promise<CurrentTenantDto> {
    const principal = request.principal as Principal;
    const tenant = await this.tenants.updateCurrent({
      tenantId: principal.tenantId,
      name: body.name,
      slug: body.slug,
    });
    return toCurrentTenantDto(tenant);
  }

  @Get(":tenantId/users")
  @ApiOperation({
    summary: "Usuarios del tenant",
    description:
      "Cualquier miembro activo. El :tenantId debe ser el del access token; si no, 404 sin distinguir el motivo.",
  })
  @ApiResponse({
    status: 200,
    description: "Lista plana (sin paginación) de usuarios del tenant.",
  })
  async listUsers(
    @Param() params: TenantIdParamDto,
    @Req() request: Request,
  ): Promise<ListResponse<TenantUserDto>> {
    const principal = request.principal as Principal;
    this.assertTenantInUrl(principal, params.tenantId);

    const members = await this.tenantUsers.listUsers(params.tenantId);
    const items = members.map(toTenantUserDto);

    return { items, total: items.length };
  }

  @Patch(":tenantId/users/:userId")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "Editar usuario del tenant",
    description:
      "OWNER/ADMIN. El ADMIN gestiona solo a no-OWNER; 403 si el objetivo es OWNER. 409 si se intenta quedar sin el último propietario.",
  })
  @ApiResponse({ status: 200, description: "Usuario actualizado." })
  @ApiResponse({ status: 403, description: "El objetivo es el OWNER y el autor no." })
  @ApiResponse({ status: 409, description: "Sería quedarse sin el último OWNER activo." })
  async updateUser(
    @Param() params: TenantUserIdParamDto,
    @Body() body: UpdateTenantUserDto,
    @Req() request: Request,
  ): Promise<UpdateTenantUserResponseDto> {
    const principal = request.principal as Principal;
    this.assertTenantInUrl(principal, params.tenantId);

    const result = await this.tenantUsers.updateUser({
      tenantId: principal.tenantId,
      targetUserId: params.userId,
      actorUserId: principal.userId,
      actorRole: principal.role,
      role: body.role,
      status: body.status,
    });

    return toUpdateTenantUserDto(result);
  }

  /**
   * `:tenantId` solo es válido si coincide con el del `Principal`. Cualquier
   * otra cosa es un 404 "no existe", nunca un 403: un 403 para ids ajenos
   * confirmaría que existen.
   */
  private assertTenantInUrl(
    principal: Principal,
    tenantId: string,
  ): void {
    if (tenantId !== principal.tenantId) {
      throw new NotFoundError("not_found", "Tenant no encontrado");
    }
  }
}