import { Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CustomerMissionStatus, GoalType, MissionStatus, Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';
import { B2cDashboardResponse, DashboardMission } from '@modules/b2c-dashboard/b2c-dashboard.types';

@Injectable()
export class B2cDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string, customerId: string): Promise<B2cDashboardResponse> {
    requireTenant(tenantId);
    if (typeof customerId !== 'string' || !customerId.trim()) {
      throw new UnauthorizedException('A customer context is required.');
    }
    const now = new Date();
    return this.prisma.$transaction(async (database) => {
      const customer = await database.customer.findFirst({
        where: { tenantId, id: customerId },
        select: { id: true, tenantId: true, name: true, phone: true, points: true },
      });
      if (!customer) throw new NotFoundException('Customer not found.');

      const missions = await database.mission.findMany({
        where: {
          tenantId, status: MissionStatus.ACTIVE, createdAt: { lte: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true, name: true, goalType: true, targetValue: true, reward: true, expiresAt: true,
          customers: { where: { tenantId, customerId }, select: { visits: true, status: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const amounts = await this.getAmountProgress(
        tenantId, database, customerId,
        missions.filter((mission) => mission.goalType === GoalType.AMOUNT).map((mission) => mission.id),
        now,
      );

      return {
        customer: { id: customer.id, tenantId: customer.tenantId, name: customer.name, phone: customer.phone },
        // This balance is maintained atomically with the immutable points ledger.
        pointsBalance: customer.points,
        missions: missions.map((mission): DashboardMission => {
          const progress = mission.customers[0];
          const current = mission.goalType === GoalType.VISITS
            ? new Prisma.Decimal(progress?.visits ?? 0)
            : amounts.get(mission.id) ?? new Prisma.Decimal(0);
          const isCompleted = progress?.status === CustomerMissionStatus.COMPLETED || current.gte(mission.targetValue);
          const remaining = isCompleted ? new Prisma.Decimal(0) : mission.targetValue.minus(current);
          const base = {
            id: mission.id, name: mission.name, isCompleted,
            reward: mission.reward, expiresAt: mission.expiresAt?.toISOString() ?? null,
          };
          if (mission.goalType === GoalType.VISITS) {
            return {
              ...base, goalType: GoalType.VISITS, targetValue: mission.targetValue.toNumber(),
              currentValue: current.toNumber(), remainingValue: remaining.toNumber(),
            };
          }
          return {
            ...base, goalType: GoalType.AMOUNT, targetValue: mission.targetValue.toFixed(2),
            currentValue: current.toFixed(2), remainingValue: remaining.toFixed(2),
          };
        }),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async getAmountProgress(
    tenantId: string,
    database: Prisma.TransactionClient,
    customerId: string,
    missionIds: string[],
    now: Date,
  ): Promise<Map<string, Prisma.Decimal>> {
    if (missionIds.length === 0) return new Map();

    // One parameterized aggregate for all amount goals, instead of one query per mission.
    const rows: unknown = await database.$queryRaw(Prisma.sql`
      SELECT m."id" AS "missionId", COALESCE(SUM(t."amount"), 0::numeric) AS "amount"
      FROM "missions" AS m
      LEFT JOIN "transactions" AS t
        ON t."tenantId" = ${tenantId}
        AND t."tenantId" = m."tenantId"
        AND t."customerId" = ${customerId}
        AND t."type" = 'SALE'
        AND t."amount" > 0
        AND t."createdAt" >= m."createdAt"
        AND t."createdAt" <= ${now}
        AND (m."expiresAt" IS NULL OR t."createdAt" < m."expiresAt")
      WHERE m."tenantId" = ${tenantId}
        AND m."goalType" = 'AMOUNT'
        AND m."id" IN (${Prisma.join(missionIds)})
      GROUP BY m."id"
    `);
    if (!Array.isArray(rows)) throw new InternalServerErrorException('Invalid amount projection.');
    const allowed = new Set(missionIds);
    const amounts = new Map<string, Prisma.Decimal>();
    for (const row of rows as unknown[]) {
      if (
        typeof row !== 'object' || row === null ||
        !('missionId' in row) || typeof row.missionId !== 'string' || !allowed.has(row.missionId) ||
        !('amount' in row) || !(row.amount instanceof Prisma.Decimal) ||
        !row.amount.isFinite() || row.amount.isNegative()
      ) {
        throw new InternalServerErrorException('Invalid amount projection.');
      }
      amounts.set(row.missionId, row.amount);
    }
    return amounts;
  }
}
