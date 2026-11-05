import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { CurrentCustomer } from '@common/decorators/current-customer.decorator';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { B2cJwtAuthGuard } from '@common/guards/b2c-jwt-auth.guard';
import { B2cDashboardService } from '@modules/b2c-dashboard/b2c-dashboard.service';

@Controller('b2c')
@UseGuards(B2cJwtAuthGuard)
export class B2cDashboardController {
  constructor(private readonly dashboard: B2cDashboardService) {}

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  getDashboard(@CurrentTenant() tenantId: string, @CurrentCustomer() customerId: string) {
    return this.dashboard.getDashboard(tenantId, customerId);
  }
}
