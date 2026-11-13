import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { requireTenant } from '@common/utils/require-tenant';
import { isValidSaleRedemptionToken, parseB2cQrPayload } from '@common/utils/b2c-qr';
import { getJwtSecret } from '@modules/auth/jwt.config';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { PrismaService } from '@database/prisma.service';

const TRANSACTION_ATTEMPTS = 5;

@Injectable()
export class B2cScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly config: ConfigService,
  ) {}

  async scan(tenantId: string, customerId: string, payload: string) {
    requireTenant(tenantId);
    if (typeof customerId !== 'string' || !customerId.trim()) throw new BadRequestException('Customer context is required.');

    const qr = parseB2cQrPayload(payload);
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, slug: qr.tenantSlug }, select: { id: true },
    });
    if (!tenant) throw new NotFoundException('QR code not found.');

    if (qr.type === 'store') {
      const result = await this.loyalty.recordStoreVisit(tenantId, customerId);
      return { type: 'store', ...result };
    }
    return this.redeemSale(tenantId, customerId, qr.token!);
  }

  private async redeemSale(tenantId: string, customerId: string, token: string) {
    const redemptionId = this.redemptionId(token);
    const signingSecret = getJwtSecret(this.config);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (database) => {
          const redemption = await database.saleRedemption.findFirst({
            where: { tenantId, id: redemptionId },
            select: {
              id: true, transactionId: true, expiresAt: true, redeemedAt: true,
              redeemedByCustomerId: true,
            },
          });
          if (!redemption || !isValidSaleRedemptionToken(
            token, signingSecret, redemption.id, tenantId, redemption.transactionId, redemption.expiresAt,
          )) throw new NotFoundException('QR code not found.');

          if (redemption.redeemedAt) {
            if (redemption.redeemedByCustomerId === customerId) {
              return { type: 'sale' as const, status: 'already_redeemed' as const, saleId: redemption.transactionId };
            }
            throw new ConflictException('This sale QR code has already been redeemed.');
          }

          const now = new Date();
          if (redemption.expiresAt <= now) throw new GoneException('This sale QR code has expired.');

          const customer = await database.customer.findFirst({
            where: { tenantId, id: customerId }, select: { id: true },
          });
          if (!customer) throw new NotFoundException('Customer not found.');

          const sale = await database.transaction.findFirst({
            where: { tenantId, id: redemption.transactionId, type: 'SALE' },
            select: { id: true, customerId: true, amount: true },
          });
          if (!sale) throw new NotFoundException('Sale not found.');
          if (sale.customerId !== null) throw new ConflictException('The sale already has a customer.');

          const claim = await database.saleRedemption.updateMany({
            where: { tenantId, id: redemption.id, redeemedAt: null, expiresAt: { gt: now } },
            data: { redeemedAt: now, redeemedByCustomerId: customerId },
          });
          if (claim.count !== 1) throw new ConflictException('This sale QR code has already been redeemed.');

          const linked = await database.transaction.updateMany({
            where: { tenantId, id: sale.id, type: 'SALE', customerId: null },
            data: { customerId },
          });
          if (linked.count !== 1) throw new ConflictException('The sale already has a customer.');

          await database.outboxEvent.create({
            data: {
              tenantId, transactionId: sale.id, type: 'sale.confirmed',
              payload: {
                version: 1, tenantId, saleId: sale.id, customerId,
                amount: sale.amount.toFixed(2), currency: 'BRL', occurredAt: now.toISOString(),
              },
            },
          });
          return {
            type: 'sale' as const,
            status: 'redeemed' as const,
            saleId: sale.id,
            amount: sale.amount.toFixed(2),
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error: unknown) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!conflict || attempt >= TRANSACTION_ATTEMPTS - 1) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  }

  private redemptionId(token: string): string {
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) {
      throw new BadRequestException('Invalid sale QR token.');
    }
    const redemptionId = Buffer.from(parts[0], 'base64url').toString('utf8');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(redemptionId)) {
      throw new BadRequestException('Invalid sale QR token.');
    }
    return redemptionId;
  }
}
