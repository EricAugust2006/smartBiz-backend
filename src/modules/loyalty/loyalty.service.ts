import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerMissionStatus, GoalType, MissionStatus, Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';

export const SALE_CONFIRMED = 'sale.confirmed';
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_POINTS = 2_147_483_647;
const TRANSACTION_ATTEMPTS = 5;

type LoyaltySale = Prisma.TransactionGetPayload<{
  select: { id: true; customerId: true; amount: true; createdAt: true };
}>;

export type LoyaltyResult =
  | { status: 'already_processed' }
  | { status: 'processed'; points: number; visitCounted: boolean };

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  async processEvent(tenantId: string, eventId: string): Promise<LoyaltyResult> {
    requireTenant(tenantId);
    if (!eventId) throw new BadRequestException('An outbox event ID is required.');

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (database) => this.applyEvent(tenantId, database, eventId),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!conflict || attempt >= TRANSACTION_ATTEMPTS - 1) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  private async applyEvent(
    tenantId: string,
    database: Prisma.TransactionClient,
    eventId: string,
  ): Promise<LoyaltyResult> {
    const event = await database.outboxEvent.findFirst({
      where: { tenantId, id: eventId, type: SALE_CONFIRMED },
      select: { transactionId: true, processedAt: true },
    });
    if (!event) throw new NotFoundException('Sale event not found.');
    if (event.processedAt) return { status: 'already_processed' };

    // Claim and completion become visible together only when this transaction commits.
    const claimed = await database.outboxEvent.updateMany({
      where: { tenantId, id: eventId, type: SALE_CONFIRMED, processedAt: null },
      data: { processedAt: new Date(), lastError: null },
    });
    if (claimed.count === 0) return { status: 'already_processed' };

    // The persisted sale is authoritative; payload values cannot choose a tenant or balance.
    const sale = await database.transaction.findFirst({
      where: { tenantId, id: event.transactionId, type: 'SALE' },
      select: { id: true, customerId: true, amount: true, createdAt: true },
    });
    if (!sale) throw new NotFoundException('Sale not found.');
    if (!sale.customerId) throw new BadRequestException('The sale has no associated customer.');
    if (!sale.amount.isFinite() || sale.amount.lte(0)) {
      throw new BadRequestException('The sale amount must be positive.');
    }

    const points = sale.amount.floor().toNumber();
    if (points > MAX_POINTS) throw new BadRequestException('Points exceed the supported integer balance.');

    // Atomic increment also serializes credits and balance snapshots for this customer.
    const credited = await database.customer.updateMany({
      where: { tenantId, id: sale.customerId, points: { lte: MAX_POINTS - points } },
      data: { points: { increment: points } },
    });
    const customer = await database.customer.findFirst({
      where: { tenantId, id: sale.customerId }, select: { points: true },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    if (credited.count !== 1) throw new BadRequestException('Points exceed the supported integer balance.');

    const previousSale = await database.transaction.findFirst({
      where: {
        tenantId, customerId: sale.customerId, type: 'SALE',
        createdAt: { gte: new Date(sale.createdAt.getTime() - COOLDOWN_MS) },
        // Millisecond ties use a deterministic order and exclude the current sale.
        OR: [
          { createdAt: { lt: sale.createdAt } },
          { createdAt: sale.createdAt, id: { lt: sale.id } },
          {
            createdAt: sale.createdAt,
            pointsLedger: { is: { tenantId, visitCounted: true } },
          },
        ],
      },
      select: { id: true },
    });
    const visitCounted = previousSale === null;
    if (visitCounted) await this.advanceMissions(tenantId, database, sale, sale.customerId);

    await database.pointsLedger.create({
      data: {
        tenantId, customerId: sale.customerId, transactionId: sale.id, eventId,
        points, balanceAfter: customer.points, visitCounted,
      },
    });

    return { status: 'processed', points, visitCounted };
  }

  private async advanceMissions(
    tenantId: string,
    database: Prisma.TransactionClient,
    sale: LoyaltySale,
    customerId: string,
  ): Promise<void> {
    const missions = await database.mission.findMany({
      where: {
        tenantId, status: MissionStatus.ACTIVE, goalType: GoalType.VISITS,
        createdAt: { lte: sale.createdAt },
        OR: [{ expiresAt: null }, { expiresAt: { gt: sale.createdAt } }],
      },
      select: { id: true },
    });
    for (const mission of missions) {
      const progress = await database.customerMission.findFirst({
        where: { tenantId, customerId, missionId: mission.id },
        select: { id: true, status: true, lastVisitAt: true },
      });
      if (progress?.status === CustomerMissionStatus.COMPLETED) continue;
      if (!progress) {
        await database.customerMission.create({
          data: { tenantId, customerId, missionId: mission.id, visits: 1, lastVisitAt: sale.createdAt },
        });
        continue;
      }
      const lastVisitAt = progress.lastVisitAt && progress.lastVisitAt > sale.createdAt
        ? progress.lastVisitAt : sale.createdAt;
      await database.customerMission.updateMany({
        where: { tenantId, id: progress.id, status: CustomerMissionStatus.PENDING },
        data: { visits: { increment: 1 }, lastVisitAt },
      });
    }
  }
}
