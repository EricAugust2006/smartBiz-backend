import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { PrismaService } from '@database/prisma.service';
import { LoyaltyService, SALE_CONFIRMED } from '@modules/loyalty/loyalty.service';

const TENANT_BATCH_SIZE = 50;
const EVENT_BATCH_SIZE = 100;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

@Injectable()
export class LoyaltyOutboxConsumer {
  private readonly logger = new Logger(LoyaltyOutboxConsumer.name);
  private running = false;
  private tenantCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @Interval('loyalty-outbox', 5000)
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Infrastructure directory: only tenant IDs are enumerated here.
      // Every event and business-data query below uses that tenant's explicit scope.
      const tenants = await this.prisma.tenant.findMany({
        where: this.tenantCursor ? { id: { gt: this.tenantCursor } } : {},
        select: { id: true }, orderBy: { id: 'asc' }, take: TENANT_BATCH_SIZE,
      });
      this.tenantCursor = tenants.length === TENANT_BATCH_SIZE ? tenants[tenants.length - 1].id : undefined;
      for (const tenant of tenants) {
        try {
          await this.processTenant(tenant.id);
        } catch (error: unknown) {
          this.logger.error(`Loyalty polling failed for tenant ${tenant.id}: ${this.failureReason(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async processTenant(tenantId: string): Promise<number> {
    requireTenant(tenantId);
    const events = await this.prisma.outboxEvent.findMany({
      where: { tenantId, type: SALE_CONFIRMED, processedAt: null, nextAttemptAt: { lte: new Date() } },
      select: { id: true, attempts: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: EVENT_BATCH_SIZE,
    });
    let processed = 0;
    for (const event of events) {
      try {
        const result = await this.loyalty.processEvent(tenantId, event.id);
        if (result.status === 'processed') processed++;
      } catch (error: unknown) {
        const reason = this.failureReason(error);
        const delay = Math.min(5000 * 2 ** Math.min(event.attempts, 10), MAX_RETRY_DELAY_MS);
        await this.prisma.outboxEvent.updateMany({
          where: { tenantId, id: event.id, processedAt: null, attempts: event.attempts },
          data: {
            attempts: { increment: 1 }, lastError: reason,
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });
        this.logger.warn(`Loyalty event ${event.id} for tenant ${tenantId} will retry: ${reason}`);
      }
    }
    return processed;
  }

  private failureReason(error: unknown): string {
    if (error instanceof HttpException) return error.message.slice(0, 500);
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
    return 'Loyalty processing failed.';
  }
}
