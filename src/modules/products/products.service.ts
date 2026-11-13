import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';
import { CreateProductDto } from '@modules/products/dto/create-product.dto';
import { FindProductsDto } from '@modules/products/dto/find-products.dto';
import { UpdateProductDto } from '@modules/products/dto/update-product.dto';

const productSelect = {
  id: true,
  tenantId: true,
  name: true,
  price: true,
  category: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ProductSelect;

type SelectedProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function serializeProduct(product: SelectedProduct) {
  return { ...product, price: product.price.toFixed(2) };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateProductDto) {
    requireTenant(tenantId);
    const product = await this.prisma.product.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        price: new Prisma.Decimal(dto.price),
        category: dto.category.trim(),
      },
      select: productSelect,
    });
    return serializeProduct(product);
  }

  async findAll(tenantId: string, query: FindProductsDto) {
    requireTenant(tenantId);
    const name = query.name?.trim();
    const category = query.category?.trim();
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        ...(name ? { name: { contains: name, mode: 'insensitive' } } : {}),
        ...(category ? { category: { equals: category, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: productSelect,
    });
    return products.map(serializeProduct);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    requireTenant(tenantId);
    if (Object.keys(dto).length === 0) throw new BadRequestException('At least one product field is required.');

    try {
      const product = await this.prisma.product.update({
        where: { tenantId, id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.category === undefined ? {} : { category: dto.category.trim() }),
          ...(dto.price === undefined ? {} : { price: new Prisma.Decimal(dto.price) }),
          ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
        },
        select: productSelect,
      });
      return serializeProduct(product);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Product not found.');
      }
      throw error;
    }
  }
}
