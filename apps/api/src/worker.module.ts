import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { validateEnv, resolveEnvPath } from "@negocia/config";
import { LLM_JOB_QUEUER, WHATSAPP_EVENT_REPOSITORY } from "./common/di-tokens";
import type { LlmJobQueuer } from "./domain/ports/llm-job-queuer";
import type { WhatsappEventRepository } from "./domain/ports/whatsapp-event-repository";
import { TenantContextModule } from "./common/tenant-context/tenant-context.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { LlmModule } from "./infrastructure/llm.module";
import { LlmJobQueue } from "./infrastructure/queues/llm-job-queue";
import { LlmJobsWorker } from "./infrastructure/workers/llm-jobs.worker";
import { WhatsappEventsWorker } from "./infrastructure/workers/whatsapp-events.worker";
import { WhatsappProviderModule } from "./infrastructure/whatsapp/whatsapp-provider.module";
import { ConversationEngineService } from "./modules/conversation-engine/application/conversation-engine.service";
import { ConversationEngineModule } from "./modules/conversation-engine/conversation-engine.module";
import { ConversationsService } from "./modules/conversations/application/conversations.service";
import { ConversationsModule } from "./modules/conversations/conversations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvPath(),
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    TenantContextModule,
    LlmModule,
    ConversationEngineModule,
    ConversationsModule,
    WhatsappProviderModule,
  ],
  providers: [
    {
      provide: LLM_JOB_QUEUER,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new LlmJobQueue(config.get("REDIS_URL", { infer: true })),
      inject: [ConfigService],
    },
    {
      provide: WhatsappEventsWorker,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        events: WhatsappEventRepository,
        queuer: LlmJobQueuer,
        conversations: ConversationsService,
      ) =>
        new WhatsappEventsWorker(
          events,
          queuer,
          conversations,
          config.get("REDIS_URL", { infer: true }),
        ),
      inject: [
        ConfigService,
        WHATSAPP_EVENT_REPOSITORY,
        LLM_JOB_QUEUER,
        ConversationsService,
      ],
    },
    {
      provide: LlmJobsWorker,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        engine: ConversationEngineService,
      ) =>
        new LlmJobsWorker(
          engine,
          config.get("REDIS_URL", { infer: true }),
        ),
      inject: [ConfigService, ConversationEngineService],
    },
  ],
})
export class WorkerModule {}
