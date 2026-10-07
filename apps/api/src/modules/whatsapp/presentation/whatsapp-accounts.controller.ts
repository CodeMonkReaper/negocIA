import { Body, Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { ListResponse } from "@negocia/contracts";
import type { Request, Response } from "express";
import { Public } from "../../../common/guards/public.decorator";
import { Roles } from "../../../common/guards/roles.decorator";
import type { Principal } from "../../../domain/tenant-context";
import { WhatsappAccountsService } from "../application/whatsapp-accounts.service";
import { EmbeddedSignupService, EmbeddedSignupUrlResponse } from "../application/embedded-signup.service";
import {
  toWhatsappAccountResponseDto,
  type WhatsappAccountResponseDto,
} from "./whatsapp-account.mapper";
import { CreateWhatsappAccountDto } from "./dto/whatsapp-account-input.dto";

/**
 * Gestión de cuentas de WhatsApp del tenant (docs/api/whatsapp.md §accounts).
 *
 * Solo OWNER: conectar un WABA compromete la facturación y el número del
 * negocio, así que no basta con ADMIN.
 */
@ApiTags("whatsapp")
@ApiBearerAuth()
@Roles("OWNER")
@Controller("whatsapp/accounts")
export class WhatsappAccountsController {
  constructor(
    private readonly accounts: WhatsappAccountsService,
    private readonly embeddedSignup: EmbeddedSignupService,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Conectar un WABA (alta manual)",
    description:
      "Registra el WABA/phone_number_id/token que el OWNER creó en Meta Developer. El token se persiste y no se devuelve.",
  })
  @ApiResponse({ status: 201, description: "Cuenta conectada." })
  @ApiResponse({ status: 409, description: "Ese WABA o número ya está conectado en el tenant." })
  async connect(
    @Body() body: CreateWhatsappAccountDto,
    @Req() request: Request,
  ): Promise<WhatsappAccountResponseDto> {
    const principal = request.principal as Principal;
    const account = await this.accounts.connect({
      tenantId: principal.tenantId,
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
      displayPhone: body.displayPhone,
      accessToken: body.accessToken,
    });
    return toWhatsappAccountResponseDto(account);
  }

  @Get()
  @ApiOperation({
    summary: "Cuentas de WhatsApp del tenant",
    description: "Lista plana de WABAs conectados. El access token nunca viaja en la respuesta.",
  })
  @ApiResponse({ status: 200, description: "Lista de cuentas conectadas." })
  async list(@Req() request: Request): Promise<ListResponse<WhatsappAccountResponseDto>> {
    const principal = request.principal as Principal;
    const accounts = await this.accounts.listByTenant(principal.tenantId);
    const items = accounts.map(toWhatsappAccountResponseDto);
    return { items, total: items.length };
  }

  // ===== Embedded Signup (M8.1) =====

  @Get("embedded-signup/url")
  @ApiOperation({
    summary: "Obtener URL de autorización para Embedded Signup",
    description:
      "Genera un state firmado (JWT, 10 min) y la URL de OAuth de Meta. El frontend abre la URL en un popup.",
  })
  @ApiResponse({ status: 200, description: "URL y state generados." })
  @ApiResponse({ status: 400, description: "META_APP_ID/META_APP_SECRET no configurados." })
  async getEmbeddedSignupUrl(@Req() request: Request): Promise<EmbeddedSignupUrlResponse> {
    const principal = request.principal as Principal;
    return this.embeddedSignup.generateAuthUrl(principal.tenantId);
  }

  // ===== Callback público (sin versión, sin guard de roles) =====

  @Public()
  @Get("embedded-signup/callback")
  @ApiOperation({
    summary: "Callback de Embedded Signup (Meta redirige aquí)",
    description:
      "Recibe `code` y `state` de Meta, valida el state, intercambia el code por token de larga duración (60d), obtiene la WABA y números, y crea/actualiza la WhatsappAccount. Devuelve HTML que cierra el popup y notifica al opener vía postMessage. Para validación de URL por Meta, devuelve 'OK' si no hay parámetros.",
  })
  @ApiQuery({ name: "code", required: false, description: "Código de autorización de Meta" })
  @ApiQuery({ name: "state", required: false, description: "State firmado (JWT) generado por la API" })
  @ApiQuery({ name: "error", required: false, description: "Error de OAuth (ej. access_denied)" })
  @ApiQuery({ name: "error_description", required: false, description: "Descripción del error" })
  async embeddedSignupCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // Validación simple para que Meta pueda verificar la URL
    // Si no hay parámetros, devuelve 'OK' para validación
    if (!code && !state && !error) {
      res.status(200).type("text/plain").send("OK - WhatsApp Embedded Signup Callback");
      return;
    }

    let result = { success: false, error: "embedded_signup_unknown_error" };

    if (error) {
      result = { success: false, error: `embedded_signup_${error}` };
    } else if (code && state) {
      result = await this.embeddedSignup.handleCallback(code, state);
    } else {
      result = { success: false, error: "embedded_signup_missing_params" };
    }

    // HTML que hace postMessage al opener y cierra la ventana
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Conectando WhatsApp...</title>
  <style>
    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .box { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .success { color: #10b981; }
    .error { color: #ef4444; }
    .spinner { border: 3px solid #e5e7eb; border-top: 3px solid #3b82f6; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner" id="spinner"></div>
    <p id="message">${result.success ? "¡Conectado correctamente!" : "Error: " + result.error}</p>
  </div>
  <script>
    (function() {
      const result = ${JSON.stringify(result)};
      const message = result.success ? "whatsapp_connected" : "whatsapp_connection_error";
      try {
        if (window.opener) {
          window.opener.postMessage({ type: message, result }, "*");
        }
      } catch (e) { console.error("postMessage failed", e); }
      setTimeout(() => window.close(), 1500);
    })();
  </script>
</body>
</html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }
}