import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateProductDto } from '@modules/products/dto/create-product.dto';
import { FindProductsDto } from '@modules/products/dto/find-products.dto';
import { UpdateProductDto } from '@modules/products/dto/update-product.dto';
import { ProductsService } from '@modules/products/products.service';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateProductDto) {
    return this.products.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: FindProductsDto) {
    return this.products.findAll(tenantId, query);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(tenantId, id, dto);
  }
}
