import {
  API_PREFIX,
  type AuthSessionDto,
  type AuthTokensDto,
  type ConversationResponseDto,
  type EmbeddedSignupUrlResponseDto,
  type ListResponse,
  type LlmRunResponseDto,
  type MeResponseDto,
  type MessageResponseDto,
  type WhatsappAccountResponseDto,
} from "@negocia/contracts";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:4000${API_PREFIX}`
).replace(/\/$/, "");

const TOKENS_KEY = "negocia.tokens";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export function loadTokens(): StoredTokens | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(TOKENS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string"
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
    };
  } catch {
    return null;
  }
}

export function saveTokens(tokens: StoredTokens): void {
  window.localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  window.localStorage.removeItem(TOKENS_KEY);
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly errorId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

interface PageParams {
  limit?: number;
  offset?: number;
  status?: string;
}

function qs(params?: PageParams): string {
  if (!params) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const raw = search.toString();
  return raw ? `?${raw}` : "";
}

async function toApiError(response: Response): Promise<ApiClientError> {
  let message = `HTTP ${response.status}`;
  let code: string | undefined;
  let errorId: string | undefined;
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === "object" && body !== null) {
      const candidate = body as {
        message?: unknown;
        code?: unknown;
        errorId?: unknown;
      };
      if (typeof candidate.message === "string") {
        message = candidate.message;
      }
      if (typeof candidate.code === "string") {
        code = candidate.code;
      }
      if (typeof candidate.errorId === "string") {
        errorId = candidate.errorId;
      }
    }
  } catch {
    // Sin cuerpo JSON: el status por sí solo basta como mensaje.
  }
  return new ApiClientError(message, response.status, code, errorId);
}

/**
 * Rotación del refresh token, single-flight.
 *
 * Varias peticiones pueden chocar con 401 a la vez; todas comparten esta única
 * promesa para no rotar la familia varias veces y revocarla por "reuso".
 */
let refreshPromise: Promise<string | null> | null = null;

function performRefresh(): Promise<string | null> {
  refreshPromise ??= (async () => {
    const tokens = loadTokens();
    if (!tokens) {
      return null;
    }
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!response.ok) {
        clearTokens();
        return null;
      }
      const data = (await response.json()) as AuthTokensDto;
      saveTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data.accessToken;
    } catch {
      clearTokens();
      return null;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const tokens = loadTokens();
  const headers: Record<string, string> = { Accept: "application/json" };
  const useAuth = options.auth !== false;
  if (useAuth && tokens?.accessToken) {
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const method = options.method ?? "GET";
  const body =
    options.body !== undefined ? JSON.stringify(options.body) : undefined;

  let response = await fetch(`${API_BASE}${path}`, { method, headers, body });

  if (response.status === 401 && useAuth && tokens?.refreshToken) {
    const accessToken = await performRefresh();
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(`${API_BASE}${path}`, { method, headers, body });
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<AuthSessionDto> {
    return request("/auth/register", {
      method: "POST",
      body: input,
      auth: false,
    });
  },

  login(input: { email: string; password: string }): Promise<AuthSessionDto> {
    return request("/auth/login", {
      method: "POST",
      body: input,
      auth: false,
    });
  },

  logout(): Promise<void> {
    return request("/auth/logout", { method: "POST", body: {} });
  },

  me(): Promise<MeResponseDto> {
    return request("/me");
  },

  accounts(): Promise<ListResponse<WhatsappAccountResponseDto>> {
    return request("/whatsapp/accounts");
  },

  embeddedSignupUrl(): Promise<EmbeddedSignupUrlResponseDto> {
    return request("/whatsapp/accounts/embedded-signup/url");
  },

  conversations(
    params?: PageParams,
  ): Promise<ListResponse<ConversationResponseDto>> {
    return request(`/conversations${qs(params)}`);
  },

  messages(
    conversationId: string,
    params?: PageParams,
  ): Promise<ListResponse<MessageResponseDto>> {
    return request(
      `/conversations/${encodeURIComponent(conversationId)}/messages${qs(params)}`,
    );
  },

  sendMessage(conversationId: string, text: string): Promise<MessageResponseDto> {
    return request(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: "POST", body: { text } },
    );
  },

  runs(
    conversationId: string,
    params?: PageParams,
  ): Promise<ListResponse<LlmRunResponseDto>> {
    return request(
      `/conversations/${encodeURIComponent(conversationId)}/runs${qs(params)}`,
    );
  },
};