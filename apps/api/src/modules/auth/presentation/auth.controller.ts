import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type {
  AuthSessionDto,
  LoginResponseDto,
  MeResponseDto,
  RefreshResponseDto,
  SwitchTenantResponseDto,
} from "@negocia/contracts";
import type { Request } from "express";
import { Public } from "../../../common/guards/public.decorator";
import type { Principal } from "../../../domain/tenant-context";
import { AuthService } from "../application/auth.service";
import { toRequestMetadata } from "../application/request-metadata";
import { toAuthSessionDto, toMeDto } from "./auth.mapper";
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchTenantDto,
} from "./dto/auth-input.dto";

/**
 * Superficie HTTP de auth (docs/api/authentication.md §4).
 *
 * Decisiones transversales:
 *
 *  - `register` y `refresh` devuelven **201**: crean estado. `login` y
 *    `switch-tenant` devuelven **200**: emitir una sesión es rotar un recurso,
 *    no crear uno nuevo desde el punto de vista del cliente. `logout` y
 *    `revoke-all` devuelven **204**: no hay cuerpo que devolver.
 *  - El body nunca lleva `tenantId` en register/login: el tenant se deriva del
 *    contexto. Solo `switch-tenant` acepta un `tenantId`, y la pertenencia se
 *    verifica contra BD.
 *  - `logout` y `revoke-all` exigen `Authorization` aunque el body no lo pida:
 *    revocar sesiones es una operación autenticada.
 */
@ApiTags("auth")
@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Post("register")
  @ApiOperation({
    summary: "Registrar cuenta",
    description:
      "Crea usuario, tenant inicial y membresía OWNER en una transacción, y devuelve la sesión inicial. 409 si el email ya existe.",
  })
  @ApiResponse({ status: 201, description: "Cuenta creada y sesión emitida." })
  @ApiResponse({ status: 409, description: "El correo ya está registrado." })
  async register(
    @Body() body: RegisterDto,
    @Req() request: Request,
  ): Promise<AuthSessionDto> {
    const session = await this.authService.register(
      { name: body.name, email: body.email, password: body.password },
      toRequestMetadata(request.headers, request.ip),
    );
    return toAuthSessionDto(session);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  @ApiOperation({
    summary: "Iniciar sesión",
    description:
      "Devuelve access JWT + refresh token opaco. Mismo código y mensaje si el email no existe o la contraseña es incorrecta.",
  })
  @ApiResponse({ status: 200, description: "Sesión emitida." })
  @ApiResponse({ status: 401, description: "Credenciales inválidas." })
  @ApiResponse({ status: 403, description: "Cuenta o membresía inactiva." })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
  ): Promise<LoginResponseDto> {
    const session = await this.authService.login(
      { email: body.email, password: body.password },
      toRequestMetadata(request.headers, request.ip),
    );
    return toAuthSessionDto(session);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  @ApiOperation({
    summary: "Rotar la sesión",
    description:
      "Entrega un par de tokens nuevo y revoca el presented. Presentar de nuevo un token ya rotado revoca la familia completa (401 `reuse_detected`).",
  })
  @ApiResponse({ status: 200, description: "Tokens rotados." })
  @ApiResponse({ status: 401, description: "Refresh inválido, expirado o reutilizado." })
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<RefreshResponseDto> {
    return this.authService.refresh(
      { refreshToken: body.refreshToken },
      toRequestMetadata(request.headers, request.ip),
    );
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  @ApiOperation({
    summary: "Cerrar la sesión actual",
    description:
      "Revoca la familia de refresh tokens identificada por el `jti` del access token.",
  })
  @ApiResponse({ status: 204, description: "Familia revocada." })
  @ApiResponse({ status: 401, description: "Falta o es inválido el access token." })
  async logout(
    @Req() request: Request,
    @Body() _body: LogoutDto,
  ): Promise<void> {
    await this.authService.logout(requireSessionId(request));
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("revoke-all")
  @ApiOperation({
    summary: "Cerrar todas las sesiones",
    description:
      "Revoca todas las familias de refresh tokens del usuario autenticado. Útil ante sospecha de robo de credenciales.",
  })
  @ApiResponse({ status: 204, description: "Todas las sesiones revocadas." })
async revokeAll(@Req() request: Request): Promise<void> {
    await this.authService.revokeAll(requireUserId(request));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("forgot-password")
  @ApiOperation({
    summary: "Solicitar recuperación de contraseña",
    description:
      "Emite un token de reset de 1-uso (15 min) y lo envía por email. Respuesta uniforme aunque el correo no exista, para no filtrar cuentas registradas.",
  })
  @ApiResponse({ status: 204, description: "Solicitud aceptada (o aparentada)." })
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword({ email: body.email });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("reset-password")
  @ApiOperation({
    summary: "Restablecer contraseña",
    description:
      "Consume el token de reset, cambia la contraseña y revoca todas las sesiones del usuario. Token inválido, vencido o usado → invalid_token (400).",
  })
  @ApiResponse({ status: 204, description: "Contraseña restablecida y sesiones revocadas." })
  @ApiResponse({ status: 400, description: "Token inválido, vencido o usado." })
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword({
      token: body.token,
      newPassword: body.newPassword,
    });
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post("switch-tenant")
  @ApiOperation({
    summary: "Cambiar de tenant",
    description:
      "Verifica la membresía activa contra BD y emite una familia de sesión nueva para el tenant destino. 403 si no hay membresía activa.",
  })
  @ApiResponse({ status: 200, description: "Sesión emitida para el nuevo tenant." })
  @ApiResponse({ status: 403, description: "Sin membresía activa en el tenant destino." })
  async switchTenant(
    @Body() body: SwitchTenantDto,
    @Req() request: Request,
  ): Promise<SwitchTenantResponseDto> {
    const session = await this.authService.switchTenant(
      requireUserId(request),
      body.tenantId,
      toRequestMetadata(request.headers, request.ip),
    );
    return toAuthSessionDto(session);
  }
}

/**
 * `GET /v1/me`: identidad y membresías de quien llama.
 *
 * Vive fuera de `/auth` porque responde a "quién soy", no a "gestionar auth",
 * y porque lo consultarán todos los clientes tras arrancar.
 */
@ApiTags("me")
@Controller({ path: "me", version: "1" })
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: "Perfil del principal",
    description:
      "Usuario, tenant activo, membresía y lista de tenants disponibles. El tenant activo es el del access token.",
  })
  @ApiResponse({ status: 200, description: "Principal resuelto desde BD." })
  @ApiResponse({ status: 403, description: "Membresía inactiva." })
  async me(@Req() request: Request): Promise<MeResponseDto> {
    const principal = requirePrincipal(request);
    return toMeDto(await this.authService.me(principal.userId, principal.tenantId));
  }
}

function requirePrincipal(request: Request): Principal {
  if (!request.principal) {
    // Los guards son globales: si el principal falta aquí, la ruta quedó
    // marcada como pública por error. Es un bug de cableado, no del cliente.
    throw new UnauthorizedException("Petición no autenticada");
  }
  return request.principal;
}

function requireUserId(request: Request): string {
  return requirePrincipal(request).userId;
}

function requireSessionId(request: Request): string {
  const sessionId = request.principal?.sessionId;
  if (!sessionId) {
    throw new UnauthorizedException("Sesión no identificable");
  }
  return sessionId;
}
