import type { LlmMessage } from '../../../domain/ports/llm-provider';
import type { MessageRecord } from '../../../domain/conversations/entities';

const MAX_HISTORY = 20;

export function buildPrompt(system: string, messages: MessageRecord[]): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: system }];
  const slice = messages.slice(-MAX_HISTORY);
  for (const m of slice) {
    if (m.direction === 'INBOUND') {
      out.push({ role: 'user', content: m.content ?? '' });
    } else if (m.direction === 'OUTBOUND') {
      out.push({ role: 'assistant', content: m.content ?? '' });
    }
  }
  return out;
}
