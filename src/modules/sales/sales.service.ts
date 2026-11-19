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
    if (!dto.idempotencyKey) throw new BadRequestException('A chave da venda é obrigatória.');
    if (dto.customerId != null && dto.customerPhone != null) {
      throw new BadRequestException('Informe o identificador ou o telefone do cliente, não ambos.');
    }

    const amount = new Prisma.Decimal(dto.amount);
    const items = [...(dto.items ?? [])].sort((a, b) =>
      (a.productId ?? a.name ?? '').localeCompare(b.productId ?? b.name ?? ''),
    );
    const catalogProductIds = items.flatMap((item) => item.productId ? [item.productId] : []);
    if (new Set(catalogProductIds).size !== catalogProductIds.length) {
      throw new BadRequestException('Cada produto do catálogo pode aparecer apenas uma vez na venda.');
    }

    const requestHash = createHash('sha256').update(JSON.stringify({
      userId,
      amount: amount.toFixed(2),
      customerId: dto.customerId ?? null,
      customerPhone: dto.customerPhone == null ? null : normalizePhone(dto.customerPhone),
      items: items.map((item) => item.productId
        ? { productId: item.productId, quantity: item.quantity }
        : {
          name: item.name?.trim(), quantity: item.quantity,
          unitPrice: item.unitPrice === undefined ? null : new Prisma.Decimal(item.unitPrice).toFixed(2),
        }),
    })).digest('hex');

    try {
      return await this.prisma.$transaction(async (database) => {
        // Recheck the staff's current membership instead of trusting a stale JWT alone.
        const staff = await database.user.findFirst({ where: { tenantId, id: userId }, select: { id: true } });
        if (!staff) throw new UnauthorizedException('O acesso do usuário não está mais válido.');

        const replay = await this.findReplay(database, tenantId, dto.idempotencyKey, requestHash);
        if (replay) return replay;

        const customer = dto.customerId != null
          ? await this.customers.findById(tenantId, dto.customerId, database)
          : dto.customerPhone != null
            ? await this.customers.findByPhone(tenantId, dto.customerPhone, database)
            : null;

        const products = catalogProductIds.length ? await database.product.findMany({
          where: { tenantId, id: { in: catalogProductIds } },
          select: { id: true, name: true, price: true, isActive: true, trackStock: true },
        }) : [];
        if (products.length !== catalogProductIds.length) throw new NotFoundException('Um ou mais produtos não foram encontrados.');
        const productsById = new Map(products.map((product) => [product.id, product]));
        if (products.some((product) => !product.isActive)) {
          throw new BadRequestException('Produtos inativos não podem ser vendidos.');
        }

        const finalizedItems = items.map((item) => {
          if (item.productId) {
            const product = productsById.get(item.productId);
            if (!product) throw new NotFoundException('Produto não encontrado.');
            return {
              productId: product.id,
              name: product.name,
              quantity: item.quantity,
              unitPrice: product.price,
              trackStock: product.trackStock,
            };
          }
          if (!item.name?.trim() || item.unitPrice === undefined) {
            throw new BadRequestException('Item avulso precisa de nome e preço unitário.');
          }
          return {
            productId: null,
            name: item.name.trim(),
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            trackStock: false,
          };
        });

        if (finalizedItems.length) {
          const total = finalizedItems.reduce(
            (sum, item) => sum.plus(item.unitPrice.times(item.quantity).toDecimalPlaces(2)),
            new Prisma.Decimal(0),
          );
          if (!total.equals(amount)) {
            throw new BadRequestException('O valor da venda deve corresponder à soma dos itens.');
          }
        }

        const sale = await database.transaction.create({
          data: {
            tenantId, customerId: customer?.id, createdById: staff.id,
            amount, type: 'SALE', idempotencyKey: dto.idempotencyKey, requestHash,
            items: {
              create: finalizedItems.map((item) => ({
                productId: item.productId, name: item.name,
                quantity: item.quantity, unitPrice: item.unitPrice,
              })),
            },
          },
          select: saleSelect,
        });

        for (const item of finalizedItems) {
          if (!item.productId || !item.trackStock) continue;
          await database.product.update({
            where: { tenantId, id: item.productId },
            data: { quantity: { decrement: new Prisma.Decimal(item.quantity) } },
            select: { id: true },
          });
        }

        if (!customer) {
          const tenant = await database.tenant.findUnique({
            where: { id: tenantId }, select: { slug: true },
          });
          if (!tenant) throw new NotFoundException('Loja não encontrada.');
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
      // Submissions can race on the unique tenant/key constraint.
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
      throw new ConflictException('A chave da venda já foi usada em uma venda diferente.');
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
