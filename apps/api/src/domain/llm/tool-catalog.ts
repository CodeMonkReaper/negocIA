import type { LlmToolDefinition } from "../ports/llm-provider";
import type { ToolResult } from "./tool-results";

export interface ToolHandlerContext {
  tenantId: string;
  conversationId: string;
}

export type ToolHandler = (args: unknown, context: ToolHandlerContext) => Promise<ToolResult> | ToolResult;

export interface RegisteredTool {
  definition: LlmToolDefinition;
  handler: ToolHandler;
}

export class ToolCatalog {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: LlmToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): LlmToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
