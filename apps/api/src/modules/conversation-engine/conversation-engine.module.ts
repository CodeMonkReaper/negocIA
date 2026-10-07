import { Module } from '@nestjs/common';
import { ConversationEngineService } from './application/conversation-engine.service';
import { ToolExecutor } from './application/tool-executor';
import { LlmModule } from '../../infrastructure/llm.module';
import { WhatsappProviderModule } from '../../infrastructure/whatsapp/whatsapp-provider.module';

@Module({
  imports: [LlmModule, WhatsappProviderModule],
  providers: [ConversationEngineService, ToolExecutor],
  exports: [ConversationEngineService, ToolExecutor],
})
export class ConversationEngineModule {}
