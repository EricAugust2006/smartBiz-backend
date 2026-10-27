import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  create(@Body() body: CreateTenantDto) {
    return this.tenants.create(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  findCurrent(@CurrentTenant() tenantId: string) {
    return this.tenants.findById(tenantId);
  }
}
