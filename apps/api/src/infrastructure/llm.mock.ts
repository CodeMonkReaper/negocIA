import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from "../domain/ports";

/** Respuesta de texto fijo del adaptador de mentira. */
export const MOCK_LLM_TEXT = "Respuesta de mentira (LLM_DRIVER=mock)";

/**
 * Adaptador de IA de mentira: guarda las peticiones en memoria y devuelve un
 * texto fijo.
 *
 * Existe porque el proveedor real necesita credenciales y porque las suites no
 * deben gastar tokens ni depender de la red. Guardar las peticiones en vez de
 * imprimirlas es deliberado: un prompt en la salida de un test es historial de
 * un cliente en la salida de un CI, y los logs de CI se archivan. Los tests
 * e2e leerán `completions` a través de `app.get(MockLlmAdapter)`.
 *
 * El texto devuelto es fijo y sin relación con la petición a propósito: cuando
 * llegue el motor (F3-3b) ningún test debe pasar por accidente porque el mock
 * "sabía" la respuesta correcta.
 */
export class MockLlmAdapter implements LlmProvider {
  readonly completions: LlmCompletionRequest[] = [];

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.completions.push(request);
    return {
      text: MOCK_LLM_TEXT,
      toolCalls: [],
      finishReason: "stop",
      model: "mock",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Vacía el buffer.
   *
   * La app del e2e es una sola instancia para toda la suite, así que sin esto
   * las peticiones de un test se filtrarían al siguiente y `completions[0]`
   * dejaría de ser "la petición de este test".
   */
  clear(): void {
    this.completions.length = 0;
  }
}
