import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { FindCustomerDto } from './dto/find-customer.dto';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCustomerDto) {
    return this.customers.create(tenantId, dto);
  }

  @Get('by-phone')
  findByPhone(@CurrentTenant() tenantId: string, @Query() query: FindCustomerDto) {
    return this.customers.findByPhone(tenantId, query.phone);
  }
}
