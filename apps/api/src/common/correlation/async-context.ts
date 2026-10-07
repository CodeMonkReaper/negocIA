import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  id: string;
}

export const correlationContext = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return correlationContext.getStore()?.id;
}