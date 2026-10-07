import { describe, expect, it, vi } from "vitest";
import { LlmError } from "../domain/errors";
import type { LlmCompletionRequest } from "../domain/ports";
import {
  OPENROUTER_BASE_URL,
  OpenRouterLlmAdapter,
  type OpenRouterLlmAdapterOptions,
} from "./llm.openrouter";

const API_KEY = "sk-or-test-key";
const MODEL = "openai/gpt-4o-mini";

function options(overrides: Partial<OpenRouterLlmAdapterOptions> = {}) {
  return { apiKey: API_KEY, model: MODEL, ...overrides };
}

/**
 * Doble de `fetch` que devuelve una respuesta con el cuerpo dado.
 *
 * Se inyecta por constructor (igual que `ResendClientLike` en el adaptador de
 * email) en vez de tocar `globalThis`: el doble queda acotado a cada test y no
 * puede filtrarse a otro.
 */
function fakeFetch(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  return vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function okCompletion(overrides: Record<string, unknown> = {}) {
  return {
    id: "gen-1",
    model: MODEL,
    choices: [{ finish_reason: "stop", message: { content: "Hola", role: "assistant" } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    ...overrides,
  };
}

function request(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return {
    messages: [
      { role: "system", content: "Eres un asistente." },
      { role: "user", content: "Hola" },
    ],
    ...overrides,
  };
}

function sentBody(fetchMock: ReturnType<typeof fakeFetch>): Record<string, unknown> {
  const body = fetchMock.mock.calls[0]![1]?.body;
  return JSON.parse(String(body)) as Record<string, unknown>;
}

describe("OpenRouterLlmAdapter", () => {
  it("llama a /chat/completions con el bearer y devuelve texto, modelo y uso", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const completion = await adapter.complete(request());

    expect(completion.text).toBe("Hola");
    expect(completion.finishReason).toBe("stop");
    expect(completion.toolCalls).toEqual([]);
    expect(completion.model).toBe(MODEL);
    expect(completion.usage).toEqual({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");

    const body = sentBody(fetchMock);
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "Eres un asistente." },
      { role: "user", content: "Hola" },
    ]);
    // Sin tools declarados no se mandan `tools` ni `tool_choice`: mandarlos vacíos
    // es un 400 en la API de chat.
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("omite temperature y max_tokens cuando no se piden", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    await adapter.complete(request());

    const body = sentBody(fetchMock);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });

  it("mapea temperature, maxTokens, tools y tool_choice cuando se piden", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    await adapter.complete(
      request({
        temperature: 0.2,
        maxTokens: 256,
        tools: [
          {
            name: "buscar_producto",
            description: "Busca un producto del catálogo",
            parameters: { type: "object", properties: { sku: { type: "string" } } },
          },
        ],
      }),
    );

    const body = sentBody(fetchMock);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "buscar_producto",
          description: "Busca un producto del catálogo",
          parameters: { type: "object", properties: { sku: { type: "string" } } },
        },
      },
    ]);
  });

  it("respeta tool_choice explícito", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    await adapter.complete(
      request({
        tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
        toolChoice: "none",
      }),
    );

    expect(sentBody(fetchMock).tool_choice).toBe("none");
  });

  it("devuelve las tool calls con los argumentos ya parseados y texto nulo", async () => {
    const fetchMock = fakeFetch({
      model: "anthropic/claude-sonnet-4.5",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "buscar_producto", arguments: '{"sku":"PAN-01"}' },
              },
            ],
          },
        },
      ],
    });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const completion = await adapter.complete(request());

    expect(completion.text).toBeNull();
    expect(completion.finishReason).toBe("tool_calls");
    expect(completion.toolCalls).toEqual([
      { id: "call_1", name: "buscar_producto", arguments: { sku: "PAN-01" } },
    ]);
    // El modelo que respondió se registra tal cual: con alias y routing puede
    // no ser el slug pedido, y es lo que permite atribuir el gasto.
    expect(completion.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("devuelve los argumentos crudos cuando el modelo no devuelve JSON válido", async () => {
    const fetchMock = fakeFetch({
      model: MODEL,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              { id: "call_1", function: { name: "buscar_producto", arguments: "no-json" } },
            ],
          },
        },
      ],
    });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const completion = await adapter.complete(request());

    expect(completion.toolCalls[0]?.arguments).toBe("no-json");
  });

  it("degrada a error un finish_reason desconocido", async () => {
    const fetchMock = fakeFetch(
      okCompletion({
        choices: [{ finish_reason: "safety_violation", message: { content: "x" } }],
      }),
    );
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const completion = await adapter.complete(request());

    expect(completion.finishReason).toBe("error");
  });

  it("traduce content_filter y length sin inventar estados", async () => {
    for (const [raw, expected] of [
      ["content_filter", "content_filter"],
      ["length", "length"],
    ] as const) {
      const fetchMock = fakeFetch(
        okCompletion({ choices: [{ finish_reason: raw, message: { content: "x" } }] }),
      );
      const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

      const completion = await adapter.complete(request());

      expect(completion.finishReason).toBe(expected);
    }
  });

  it("omite usage ausente y calcula el total", async () => {
    const fetchMock = fakeFetch(okCompletion({ usage: undefined }));
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const completion = await adapter.complete(request());

    expect(completion.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it("envía los headers de atribución solo si están configurados", async () => {
    const sinAtribucion = fakeFetch(okCompletion());
    await new OpenRouterLlmAdapter(options(), sinAtribucion).complete(request());
    const headersSin = sinAtribucion.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headersSin["HTTP-Referer"]).toBeUndefined();
    expect(headersSin["X-OpenRouter-Title"]).toBeUndefined();

    const conAtribucion = fakeFetch(okCompletion());
    await new OpenRouterLlmAdapter(
      options({ appUrl: "https://app.negocia.com", appTitle: "negocIA" }),
      conAtribucion,
    ).complete(request());
    const headersCon = conAtribucion.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headersCon["HTTP-Referer"]).toBe("https://app.negocia.com");
    expect(headersCon["X-OpenRouter-Title"]).toBe("negocIA");
  });

  it("acepta baseUrl con barra final y la normaliza", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(
      options({ baseUrl: "https://proxy.interno/v1/" }),
      fetchMock,
    );

    await adapter.complete(request());

    expect(fetchMock.mock.calls[0]![0]).toBe("https://proxy.interno/v1/chat/completions");
  });

  it("propaga el timeout en la señal de aborto", async () => {
    const fetchMock = fakeFetch(okCompletion());
    const adapter = new OpenRouterLlmAdapter(options({ timeoutMs: 1234 }), fetchMock);

    await adapter.complete(request());

    const signal = fetchMock.mock.calls[0]![1]?.signal as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, /rechazó la API key/],
    [402, /se quedó sin créditos/],
    [429, /aplicó rate limit/],
    [500, /rechazó la petición/],
    [503, /rechazó la petición/],
  ])("traduce el status %i a LlmError con mensaje propio", async (status, expected) => {
    const fetchMock = fakeFetch({ error: { message: "boom", code: 400 } }, { status });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const error = await adapter.complete(request()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toMatch(expected);
    expect((error as LlmError).details).toMatchObject({ status, providerCode: 400 });
  });

  it("nunca incluye la API key en el error", async () => {
    const fetchMock = fakeFetch({ error: { message: "No auth" } }, { status: 401 });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const error = await adapter.complete(request()).catch((e: unknown) => e);

    expect(JSON.stringify({ ...(error as LlmError) })).not.toContain(API_KEY);
    expect(JSON.stringify((error as LlmError).details)).not.toContain(API_KEY);
  });

  it("falla cuando la respuesta no es JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>502</html>", { status: 200 }));
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    await expect(adapter.complete(request())).rejects.toBeInstanceOf(LlmError);
  });

  it("falla cuando(choices viene vacío", async () => {
    const fetchMock = fakeFetch(okCompletion({ choices: [] }));
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const error = await adapter.complete(request()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toMatch(/sin una elección utilizable/);
  });

  it("falla cuando el cuerpo 200 no trae choices", async () => {
    const fetchMock = fakeFetch({ id: "gen-1", model: MODEL });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    await expect(adapter.complete(request())).rejects.toThrow(/cuerpo inesperado/);
  });

  it("traduce un timeout de red a LlmError", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const fetchMock = vi.fn(async () => {
      throw timeout;
    });
    const adapter = new OpenRouterLlmAdapter(options({ timeoutMs: 500 }), fetchMock);

    const error = await adapter.complete(request()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toMatch(/no respondió dentro de 500 ms/);
  });

  it("traduce un fallo de red a LlmError sin filtrar la excepción", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = new OpenRouterLlmAdapter(options(), fetchMock);

    const error = await adapter.complete(request()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).message).toMatch(/No se pudo contactar con OpenRouter/);
    expect((error as LlmError).details).toEqual({ reason: "TypeError" });
  });
});
