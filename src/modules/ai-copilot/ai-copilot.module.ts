import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@database/database.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AiCopilotController } from './ai-copilot.controller';
import { AiCopilotService } from './ai-copilot.service';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [AiCopilotController],
  providers: [AiCopilotService],
  exports: [AiCopilotService],
})
export class AiCopilotModule {}
