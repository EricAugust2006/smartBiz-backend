import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { CurrentCustomer } from '@common/decorators/current-customer.decorator';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { B2cJwtAuthGuard } from '@common/guards/b2c-jwt-auth.guard';
import { B2cDashboardService } from '@modules/b2c-dashboard/b2c-dashboard.service';
import { B2cScanService } from '@modules/b2c-dashboard/b2c-scan.service';
import { ScanQrDto } from '@modules/b2c-dashboard/dto/scan-qr.dto';

@Controller('b2c')
@UseGuards(B2cJwtAuthGuard)
export class B2cDashboardController {
  constructor(
    private readonly dashboard: B2cDashboardService,
    private readonly scanner: B2cScanService,
  ) {}

  @Get('dashboard')
  @Header('Cache-Control', 'private, no-store')
  getDashboard(@CurrentTenant() tenantId: string, @CurrentCustomer() customerId: string) {
    return this.dashboard.getDashboard(tenantId, customerId);
  }

  @Post('scan')
  @Header('Cache-Control', 'private, no-store')
  scan(
    @CurrentTenant() tenantId: string,
    @CurrentCustomer() customerId: string,
    @Body() dto: ScanQrDto,
  ) {
    return this.scanner.scan(tenantId, customerId, dto.payload);
  }
}
