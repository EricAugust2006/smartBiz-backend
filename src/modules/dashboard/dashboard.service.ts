import { Injectable } from '@nestjs/common';
import { MissionStatus, Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';

const recentSaleSelect = {
  id: true,
  amount: true,
  createdAt: true,
  customer: { select: { name: true, phone: true } },
} satisfies Prisma.TransactionSelect;

type RecentSale = Prisma.TransactionGetPayload<{ select: typeof recentSaleSelect }>;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(tenantId: string) {
    requireTenant(tenantId);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    return this.prisma.$transaction(async (database) => {
      const [revenue, monthlyRevenue, totalCustomers, activeMissions, recentSales, lowStockCount, expiringSoonCount] = await Promise.all([
        database.transaction.aggregate({
          where: { tenantId, type: 'SALE' },
          _sum: { amount: true },
        }),
        database.transaction.aggregate({
          where: { tenantId, type: 'SALE', createdAt: { gte: monthStart } },
          _sum: { amount: true },
        }),
        database.customer.count({ where: { tenantId } }),
        database.mission.count({ where: { tenantId, status: MissionStatus.ACTIVE } }),
        database.transaction.findMany({
          where: { tenantId, type: 'SALE' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: recentSaleSelect,
        }),
        database.product.count({
          where: {
            tenantId,
            isActive: true,
            trackStock: true,
            quantity: { lte: database.product.fields.minQuantity },
          },
        }),
        database.product.count({
          where: { tenantId, expiresAt: { gte: now, lte: sevenDaysFromNow } },
        }),
      ]);

      return {
        totalRevenue: (revenue._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        monthlyRevenue: (monthlyRevenue._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
        totalCustomers,
        activeMissions,
        inventoryAlerts: { lowStockCount, expiringSoonCount },
        recentSales: recentSales.map((sale: RecentSale) => ({
          id: sale.id,
          amount: sale.amount.toFixed(2),
          createdAt: sale.createdAt.toISOString(),
          customer: sale.customer,
        })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
