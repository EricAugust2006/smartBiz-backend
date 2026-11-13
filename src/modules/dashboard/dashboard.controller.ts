import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { DashboardService } from '@modules/dashboard/dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('metrics')
  getMetrics(@CurrentTenant() tenantId: string) {
    return this.dashboard.getMetrics(tenantId);
  }
}
