import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { LlmJobInput, LlmJobQueuer } from "../../domain/ports/llm-job-queuer";

export const LLM_JOBS_QUEUE = "llm-jobs";

@Injectable()
export class LlmJobQueue implements LlmJobQueuer, OnModuleDestroy {
  private readonly queue: Queue<LlmJobInput>;

  constructor(connectionString: string) {
    this.queue = new Queue<LlmJobInput>(LLM_JOBS_QUEUE, {
      connection: new Redis(connectionString, {
        maxRetriesPerRequest: null,
        connectTimeout: 1_000,
        commandTimeout: 1_000,
      }),
    });
  }

  async enqueue(job: LlmJobInput): Promise<void> {
    await this.queue.add("respond", job, {
      jobId: job.requestId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
