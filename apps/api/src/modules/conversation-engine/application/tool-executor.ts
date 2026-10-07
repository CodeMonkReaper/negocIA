import { Injectable } from '@nestjs/common';
import type { ToolHandlerContext, ToolCatalog } from '../../../domain/llm/tool-catalog';
import type { ToolResult } from '../../../domain/llm/tool-results';
import type { LlmToolCall } from '../../../domain/ports/llm-provider';

@Injectable()
export class ToolExecutor {
  async execute(catalog: ToolCatalog, calls: LlmToolCall[], ctx: ToolHandlerContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const c of calls) {
      const reg = catalog.get(c.name);
      if (!reg) {
        results.push({ toolCallId: c.id, name: c.name, ok: false, output: 'unknown tool' });
        continue;
      }
      try {
        const out = await reg.handler(c.arguments, ctx);
        results.push(out);
      } catch (error: unknown) {
        const e = error as { message?: string } | null;
        results.push({ toolCallId: c.id, name: c.name, ok: false, output: e?.message ?? 'error' });
      }
    }
    return results;
  }
}
