import { Module } from '@nestjs/common';
import { AiCopilotService } from './ai-copilot.service';

@Module({
  providers: [AiCopilotService],
  exports: [AiCopilotService],
})
export class AiCopilotModule {}
