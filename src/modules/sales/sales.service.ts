import {
  BadRequestException, ConflictException, Injectable, NotFoundException, Optional, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { getJwtSecret } from '@modules/auth/jwt.config';
import { createB2cScanUrl, createSaleRedemptionToken } from '@common/utils/b2c-qr';
import { requireTenant } from '../../common/utils/require-tenant';
import { PrismaService } from '../../database/prisma.service';
import { normalizePhone } from '../customers/customer-identifiers';
import { CustomersService } from '../customers/customers.service';
import { CreateSaleDto } from './dto/create-sale.dto';

const saleSelect = {
  id: true, tenantId: true, customerId: true, createdById: true, amount: true,
  type: true, createdAt: true, idempotencyKey: true,
  items: {
    select: { productId: true, name: true, quantity: true, unitPrice: true },
    orderBy: { productId: 'asc' },
  },
} satisfies Prisma.TransactionSelect;

const SALE_QR_TTL_MS = 15 * 60 * 1000;
const DEFAULT_B2C_APP_URL = 'http://localhost:3000';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    @Optional()
    private readonly config?: ConfigService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateSaleDto) {
    requireTenant(tenantId);
    if (!userId) throw new UnauthorizedException();
    if (!dto.idempotencyKey) throw new BadRequestException('An idempotency key is required.');
    if (dto.customerId != null && dto.customerPhone != null) {
      throw new BadRequestException('Provide customerId or customerPhone, not both.');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const items = [...(dto.items ?? [])].sort((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      throw new BadRequestException('Each product may appear only once.');
    }
    if (items.length) {
      const total = items.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.unitPrice).times(item.quantity)),
        new Prisma.Decimal(0),
      );
      if (!total.equals(amount)) {
        throw new BadRequestException('Amount must equal the sum of sale items.');
      }
    }

    const requestHash = createHash('sha256').update(JSON.stringify({
      userId,
      amount: amount.toFixed(2),
      customerId: dto.customerId ?? null,
      customerPhone: dto.customerPhone == null ? null : normalizePhone(dto.customerPhone),
      items: items.map((item) => ({
        productId: item.productId, quantity: item.quantity,
        unitPrice: new Prisma.Decimal(item.unitPrice).toFixed(2),
      })),
    })).digest('hex');

    try {
      return await this.prisma.$transaction(async (database) => {
        // Recheck the staff's current membership instead of trusting a stale JWT alone.
        const staff = await database.user.findFirst({ where: { tenantId, id: userId }, select: { id: true } });
        if (!staff) throw new UnauthorizedException('Staff access is no longer valid.');

        const replay = await this.findReplay(database, tenantId, dto.idempotencyKey, requestHash);
        if (replay) return replay;

        const customer = dto.customerId != null
          ? await this.customers.findById(tenantId, dto.customerId, database)
          : dto.customerPhone != null
            ? await this.customers.findByPhone(tenantId, dto.customerPhone, database)
            : null;

        const products = items.length ? await database.product.findMany({
          where: { tenantId, id: { in: items.map((item) => item.productId) } },
          select: { id: true, name: true },
        }) : [];
        if (products.length !== items.length) throw new NotFoundException('Product not found.');
        const names = new Map(products.map((product) => [product.id, product.name]));

        const sale = await database.transaction.create({
          data: {
            tenantId, customerId: customer?.id, createdById: staff.id,
            amount, type: 'SALE', idempotencyKey: dto.idempotencyKey, requestHash,
            items: {
              create: items.map((item) => ({
                tenantId, productId: item.productId, name: names.get(item.productId)!,
                quantity: item.quantity, unitPrice: new Prisma.Decimal(item.unitPrice),
              })),
            },
          },
          select: saleSelect,
        });

        if (!customer) {
          const tenant = await database.tenant.findUnique({
            where: { id: tenantId }, select: { slug: true },
          });
          if (!tenant) throw new NotFoundException('Store not found.');
          const redemptionId = randomUUID();
          const expiresAt = new Date(sale.createdAt.getTime() + SALE_QR_TTL_MS);
          await database.saleRedemption.create({
            data: { id: redemptionId, tenantId, transactionId: sale.id, expiresAt },
          });
          const token = createSaleRedemptionToken(
            getJwtSecret(this.qrConfig()), redemptionId, tenantId, sale.id, expiresAt,
          );
          const appUrl = this.qrConfig().get<string>('B2C_APP_URL') ?? DEFAULT_B2C_APP_URL;
          return {
            ...sale,
            redemption: {
              url: createB2cScanUrl(appUrl, tenant.slug, 'sale', token),
              expiresAt: expiresAt.toISOString(),
            },
          };
        }

        if (customer) {
          // The future loyalty consumer must credit this sale once, independently of mission cooldowns.
          await database.outboxEvent.create({
            data: {
              tenantId, transactionId: sale.id, type: 'sale.confirmed',
              payload: {
                version: 1, tenantId, saleId: sale.id, customerId: customer.id,
                amount: amount.toFixed(2), currency: 'BRL', occurredAt: sale.createdAt.toISOString(),
              },
            },
          });
        }

        return sale;
      });
    } catch (error) {
      // Concurrent submissions can race on the unique tenant/key constraint.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findReplay(this.prisma, tenantId, dto.idempotencyKey, requestHash);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async findReplay(
    database: Pick<Prisma.TransactionClient, 'transaction' | 'saleRedemption' | 'tenant'>,
    tenantId: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const existing = await database.transaction.findFirst({
      where: { tenantId, idempotencyKey }, select: { ...saleSelect, requestHash: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ConflictException('Idempotency key was already used for a different sale.');
    }
    const { requestHash: _hash, ...sale } = existing;
    if (sale.customerId !== null) return sale;

    const [redemption, tenant] = await Promise.all([
      database.saleRedemption.findFirst({
        where: { tenantId, transactionId: sale.id }, select: { id: true, expiresAt: true },
      }),
      database.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }),
    ]);
    if (!redemption || !tenant) return sale;
    const token = createSaleRedemptionToken(
      getJwtSecret(this.qrConfig()), redemption.id, tenantId, sale.id, redemption.expiresAt,
    );
    const appUrl = this.qrConfig().get<string>('B2C_APP_URL') ?? DEFAULT_B2C_APP_URL;
    return {
      ...sale,
      redemption: {
        url: createB2cScanUrl(appUrl, tenant.slug, 'sale', token),
        expiresAt: redemption.expiresAt.toISOString(),
      },
    };
  }

  private qrConfig(): ConfigService {
    if (!this.config) throw new Error('ConfigService is required to issue sale QR codes.');
    return this.config;
  }
}
