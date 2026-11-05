import {
  BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
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

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
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
    database: Pick<Prisma.TransactionClient, 'transaction'>,
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
    return sale;
  }
}
