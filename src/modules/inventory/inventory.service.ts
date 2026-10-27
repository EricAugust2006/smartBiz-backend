import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async checkExpiringItems(tenantId: string) {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    return this.prisma.product.findMany({
      where: {
        tenantId,
        expirationDate: {
          lte: sevenDaysFromNow,
          gte: new Date(),
        },
      },
    });
  }

  async getLowStockItems(tenantId: string) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        quantity: {
          lte: this.prisma.product.fields.minQuantity,
        },
      },
    });
  }
}
