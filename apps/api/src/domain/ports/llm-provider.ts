/**
 * Puerto del proveedor de IA (F3-3).
 *
 * Es la frontera con la que el motor de conversación habla con un modelo. Tres
 * decisiones son normativas y conviene no re-litigarlas al implementar:
 *
 * 1. **El puerto no conoce el tenant.** No hay `tenantId` en ninguna firma. El
 *    aislamiento es responsabilidad de quien llama (el application service), y
 *    el registro de gasto por tenant vivirá en `llm_runs` (hito del motor), no
 *    aquí. Un puerto que llevara el tenant obligaría a la IA a enterarse del
 *    multitenant, que es justo lo que ADR-001 quiere evitar.
 * 2. **La IA nunca es la fuente de verdad.** Este puerto devuelve texto
 *    proposed; escribir en la BD es de los application services y sus puertos.
 * 3. **Los tools se declaran aquí aunque este hito no los use.** El catálogo de
 *    tools pertenece al motor (F3-3b). Declarar la forma ahora evita romper el
 *    puerto —y sus fakes— cuando lleguen.
 *
 * `finishReason` refleja los valores normalizados que garantiza el proveedor;
 * el adaptador traduce cualquier valor desconocido a `"error"` en lugar de
 * inventar un estado nuevo.
 */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

/** Tool que el modelo puede pedir. `parameters` es un JSON Schema objeto. */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

/** Tool que el modelo pidió y que el backend tiene que ejecutar. */
export interface LlmToolCall {
  id: string;
  name: string;
  /** Argumentos ya parseados desde el JSON que devuelve el modelo. */
  arguments: unknown;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletion {
  /** `null` cuando el modelo terminó pidiendo tools: no hay respuesta aún. */
  text: string | null;
  toolCalls: LlmToolCall[];
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  /**
   * Slug del modelo que **realmente** respondió. No tiene que ser el solicitado:
   * los agregadores rutean entre proveedores del mismo modelo y pueden aplicar
   * alias. Se registra tal cual para poder atribuir el gasto.
   */
  model: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  complete(request: LlmCompletionRequest): Promise<LlmCompletion>;
}
