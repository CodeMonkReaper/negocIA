import { ExternalProviderError } from "../../domain/errors";
import { safeJsonParse } from "../../common/utils/json-parser";

const META_GRAPH_API_VERSION = "v21.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface BusinessResponse {
  data: Array<{
    id: string;
    name: string;
    verification_status: string;
  }>;
}

interface WabaResponse {
  data: Array<{
    id: string;
    name: string;
    phone_numbers: Array<{
      id: string;
      phone_number: string;
      display_phone_number: string;
      verified_name: string;
      quality_rating: string;
      code_verification_status: string;
    }>;
  }>;
}

function isTokenExchangeResponse(body: unknown): body is TokenExchangeResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "access_token" in body &&
    typeof (body as TokenExchangeResponse).access_token === "string"
  );
}

function isBusinessResponse(body: unknown): body is BusinessResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray((body as BusinessResponse).data)
  );
}

function isWabaResponse(body: unknown): body is WabaResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Array.isArray((body as WabaResponse).data)
  );
}

export interface WabaInfo {
  id: string;
  name: string;
  phoneNumbers: Array<{
    id: string;
    phoneNumber: string;
    displayPhoneNumber: string;
    verifiedName: string;
  }>;
}

/**
 * Cliente HTTP para operaciones OAuth de Meta (Embedded Signup).
 *
 * Maneja:
 * - Intercambio de `code` por `access_token` de larga duración (60 días)
 * - Obtención de WABA asociada al usuario
 * - Obtención de números de teléfono de la WABA
 */
export class MetaOAuthClient {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly redirectUri: string,
    private readonly baseUrl = META_GRAPH_BASE_URL,
  ) {}

  /**
   * Construye la URL de autorización para Embedded Signup.
   *
   * Scopes requeridos:
   * - whatsapp_business_management: gestionar WABA
   * - whatsapp_business_messaging: enviar/recibir mensajes
   */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      state,
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      response_type: "code",
    });
    return `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Intercambia el `code` de autorización por un `access_token` de larga duración (60 días).
   *
   * POST /oauth/access_token
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
      grant_type: "authorization_code",
    });

    const response = await fetch(`${this.baseUrl}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const rawBody = await safeJsonParse<TokenExchangeResponse>(response);

    if (!response.ok || !isTokenExchangeResponse(rawBody)) {
      throw new ExternalProviderError(
        "Meta OAuth: error intercambiando code por token",
        { status: response.status, body: rawBody },
      );
    }

    return {
      accessToken: rawBody.access_token,
      expiresIn: rawBody.expires_in,
    };
  }

  /**
   * Obtiene la WABA (WhatsApp Business Account) asociada al token.
   *
   * GET /me/businesses -> busca WABA en los negocios
   */
  async getWabaInfo(accessToken: string): Promise<WabaInfo> {
    // Primero obtenemos los negocios del usuario
    const businessesResponse = await fetch(`${this.baseUrl}/me/businesses`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const businessesBody = await safeJsonParse<BusinessResponse>(businessesResponse);

    if (!businessesResponse.ok || !isBusinessResponse(businessesBody)) {
      throw new ExternalProviderError(
        "Meta OAuth: error obteniendo negocios",
        { status: businessesResponse.status, body: businessesBody },
      );
    }

    // Buscar WABA en los negocios (el primer negocio con WABA)
    for (const business of businessesBody.data) {
      const wabaResponse = await fetch(
        `${this.baseUrl}/${business.id}/owned_whatsapp_business_accounts`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const wabaBody = await safeJsonParse<WabaResponse>(wabaResponse);

      if (wabaResponse.ok && isWabaResponse(wabaBody) && wabaBody.data.length > 0) {
        const waba = wabaBody.data[0];
        const phoneNumbers = waba.phone_numbers?.map((pn) => ({
          id: pn.id,
          phoneNumber: pn.phone_number,
          displayPhoneNumber: pn.display_phone_number,
          verifiedName: pn.verified_name,
        })) ?? [];

        return {
          id: waba.id,
          name: waba.name,
          phoneNumbers,
        };
      }
    }

    throw new ExternalProviderError("No se encontró WABA asociada al usuario");
  }

  /**
   * Obtiene los números de teléfono de una WABA específica.
   *
   * GET /{waba_id}/phone_numbers
   */
  async getPhoneNumbers(
    wabaId: string,
    accessToken: string,
  ): Promise<WabaInfo["phoneNumbers"]> {
    const response = await fetch(`${this.baseUrl}/${wabaId}/phone_numbers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const rawBody = await safeJsonParse(response);

    if (!response.ok) {
      throw new ExternalProviderError(
        "Meta OAuth: error obteniendo números de teléfono",
        { status: response.status, body: rawBody },
      );
    }

    if (typeof rawBody === "object" && rawBody !== null && "data" in rawBody) {
      const data = (rawBody as { data: unknown[] }).data;
      return data
        .filter((pn): pn is Record<string, unknown> => typeof pn === "object" && pn !== null)
        .map((pn) => ({
          id: String(pn.id ?? ""),
          phoneNumber: String(pn.phone_number ?? ""),
          displayPhoneNumber: String(pn.display_phone_number ?? ""),
          verifiedName: String(pn.verified_name ?? ""),
        }))
        .filter((pn) => pn.id && pn.phoneNumber);
    }

    return [];
  }
}