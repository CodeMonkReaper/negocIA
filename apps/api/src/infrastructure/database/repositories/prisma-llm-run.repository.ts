import { Injectable } from '@nestjs/common';
import type { PrismaClient, LlmRun } from '@negocia/database';
import type {
  CompleteLlmRunDraft,
  LlmRunRecord,
  StartLlmRunDraft,
} from '../../../domain/llm/entities';
import type { LlmRunRepository } from '../../../domain/ports/llm-run-repository';

/**
 * Convierte un registro de Prisma LlmRun a la entidad de dominio LlmRunRecord.
 */
function toLlmRunRecord(row: LlmRun): LlmRunRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    inboundMessageId: row.inboundMessageId,
    outboundMessageId: row.outboundMessageId,
    requestId: row.requestId,
    status: row.status as LlmRunRecord['status'],
    driver: row.driver,
    requestedModel: row.requestedModel,
    resolvedModel: row.resolvedModel,
    finishReason: row.finishReason,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    toolCalls: row.toolCalls,
    attempts: row.attempts,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaLlmRunRepository implements LlmRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(draft: StartLlmRunDraft): Promise<LlmRunRecord | 'duplicated'> {
    try {
      const row = await this.db.llmRun.create({
        data: {
          tenantId: draft.tenantId,
          conversationId: draft.conversationId,
          inboundMessageId: draft.inboundMessageId,
          requestId: draft.requestId,
          driver: draft.driver,
          requestedModel: draft.requestedModel,
          status: 'RUNNING',
        },
      });
      return toLlmRunRecord(row);
    } catch (e: unknown) {
      const prismaError = e as { code?: string };
      if (prismaError.code === 'P2002') return 'duplicated';
      throw e;
    }
  }

  async findByRequestId(tenantId: string, requestId: string): Promise<LlmRunRecord | null> {
    const row = await this.db.llmRun.findFirst({ where: { tenantId, requestId } });
    return row ? toLlmRunRecord(row) : null;
  }

  async markSucceeded(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null> {
    try {
      const row = await this.db.llmRun.update({
        where: { requestId, tenantId },
        data: {
          status: 'SUCCEEDED',
          resolvedModel: draft.resolvedModel,
          finishReason: draft.finishReason,
          promptTokens: draft.promptTokens,
          completionTokens: draft.completionTokens,
          totalTokens: draft.totalTokens,
          toolCalls: draft.toolCalls,
          latencyMs: draft.latencyMs,
          completedAt: new Date(),
          outboundMessageId: draft.outboundMessageId ?? null,
        },
      });
      return toLlmRunRecord(row);
    } catch (e: unknown) {
      const prismaError = e as { code?: string };
      if (prismaError.code === 'P2025') return null;
      throw e;
    }
  }

  async markFailed(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null> {
    try {
      const row = await this.db.llmRun.update({
        where: { requestId, tenantId },
        data: {
          status: 'FAILED',
          resolvedModel: draft.resolvedModel,
          finishReason: draft.finishReason,
          promptTokens: draft.promptTokens,
          completionTokens: draft.completionTokens,
          totalTokens: draft.totalTokens,
          toolCalls: draft.toolCalls,
          latencyMs: draft.latencyMs,
          errorCode: draft.errorCode,
          errorMessage: draft.errorMessage,
          completedAt: new Date(),
          outboundMessageId: draft.outboundMessageId ?? null,
        },
      });
      return toLlmRunRecord(row);
    } catch (e: unknown) {
      const prismaError = e as { code?: string };
      if (prismaError.code === 'P2025') return null;
      throw e;
    }
  }

  async markSkipped(tenantId: string, requestId: string): Promise<LlmRunRecord | null> {
    try {
      const row = await this.db.llmRun.update({
        where: { requestId, tenantId },
        data: { status: 'SKIPPED', completedAt: new Date() },
      });
      return toLlmRunRecord(row);
    } catch (e: unknown) {
      const prismaError = e as { code?: string };
      if (prismaError.code === 'P2025') return null;
      throw e;
    }
  }
}
