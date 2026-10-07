import { describe, expect, it } from "vitest";
import type { LlmCompletionRequest } from "../domain/ports";
import { MOCK_LLM_TEXT, MockLlmAdapter } from "./llm.mock";

function request(overrides: Partial<LlmCompletionRequest> = {}): LlmCompletionRequest {
  return { messages: [{ role: "user", content: "¿Tenés pan?" }], ...overrides };
}

describe("MockLlmAdapter", () => {
  it("devuelve un texto fijo sin tocar la red", async () => {
    const adapter = new MockLlmAdapter();

    const completion = await adapter.complete(request());

    expect(completion.text).toBe(MOCK_LLM_TEXT);
    expect(completion.toolCalls).toEqual([]);
    expect(completion.finishReason).toBe("stop");
    expect(completion.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("guarda cada petición en el buffer para poder inspeccionarla", async () => {
    const adapter = new MockLlmAdapter();

    await adapter.complete(request());
    await adapter.complete(request({ messages: [{ role: "user", content: "¿Y queso?" }] }));

    expect(adapter.completions).toHaveLength(2);
    expect(adapter.completions[1]?.messages[0]?.content).toBe("¿Y queso?");
  });

  it("clear() vacía el buffer", async () => {
    const adapter = new MockLlmAdapter();
    await adapter.complete(request());

    adapter.clear();

    expect(adapter.completions).toHaveLength(0);
  });

  it("no filtra peticiones entre instancias", async () => {
    const uno = new MockLlmAdapter();
    const otro = new MockLlmAdapter();

    await uno.complete(request());

    expect(otro.completions).toHaveLength(0);
  });
});
