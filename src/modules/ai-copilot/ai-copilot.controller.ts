import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AskCopilotDto } from './dto/ask-copilot.dto';
import { AiCopilotService } from './ai-copilot.service';

@Controller('copilot')
@UseGuards(JwtAuthGuard)
export class AiCopilotController {
  constructor(private readonly copilot: AiCopilotService) {}

  @Post('ask')
  ask(@CurrentTenant() tenantId: string, @Body() dto: AskCopilotDto) {
    return this.copilot.askCopilot(tenantId, dto.question);
  }
}
