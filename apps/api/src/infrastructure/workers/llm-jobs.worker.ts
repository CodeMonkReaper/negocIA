import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Job, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { ConversationEngineService } from "../../modules/conversation-engine/application/conversation-engine.service";
import { LLM_JOBS_QUEUE } from "../queues/llm-job-queue";

export interface LlmJobData {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  requestId: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseLlmJob(data: unknown): LlmJobData {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(d.tenantId) || !isNonEmptyString(d.conversationId) || !isNonEmptyString(d.inboundMessageId) || !isNonEmptyString(d.requestId)) {
    throw new UnrecoverableError("Invalid LLM job payload");
  }
  return {
    tenantId: d.tenantId,
    conversationId: d.conversationId,
    inboundMessageId: d.inboundMessageId,
    requestId: d.requestId,
  };
}

@Injectable()
export class LlmJobsWorker implements OnModuleDestroy {
  private readonly worker: Worker;

  constructor(
    private readonly engine: ConversationEngineService,
    connectionString: string,
  ) {
    this.worker = new Worker(
      LLM_JOBS_QUEUE,
      async (job: Job) => {
        const input = parseLlmJob(job.data);
        await this.engine.respond(input);
      },
      {
        connection: new Redis(connectionString, {
          maxRetriesPerRequest: null,
        }),
        concurrency: 2,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
  }
}
