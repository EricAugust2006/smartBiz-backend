import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { SalesService } from '../src/modules/sales/sales.service';

// Run against a dedicated test database with migrations already applied.
// This suite never falls back to the application's DATABASE_URL.
test('sales constraints, concurrency and rollback on PostgreSQL', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const tenantIds = [randomUUID(), randomUUID()];
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });
  await prisma.$connect();
  const database = prisma as PrismaService;
  const customers = new CustomersService(database);
  const sales = new SalesService(database, customers);

  const fixtures = [] as Array<{ tenantId: string; staffId: string; productId: string; customerId: string }>;
  for (const tenantId of tenantIds) {
    const tenant = await prisma.tenant.create({
      data: {
        id: tenantId, name: 'Sales integration test', slug: `sales-test-${tenantId}`,
        users: { create: { name: 'Staff', email: `${tenantId}@example.test`, passwordHash: 'test-only', role: 'STAFF' } },
        products: { create: { name: 'Café', category: 'Bebida', price: 0.1, quantity: 20, costPrice: 0.05 } },
      },
      include: { users: true, products: true },
    });
    const customer = await customers.create(tenantId, {
      name: 'Customer', phone: '(11) 99999-0000', cpf: '529.982.247-25',
    });
    fixtures.push({ tenantId, staffId: tenant.users[0].id, productId: tenant.products[0].id, customerId: customer.id });
  }
  const [a, b] = fixtures;
  const payload = (changes: Record<string, any> = {}) => ({
    idempotencyKey: randomUUID(), amount: 0.3, customerId: a.customerId,
    items: [{ productId: a.productId, quantity: 3, unitPrice: 0.1 }], ...changes,
  });

  await context.test('phone and CPF uniqueness is local to a store', async () => {
    assert.notEqual(a.customerId, b.customerId);
    await assert.rejects(customers.create(a.tenantId, {
      name: 'Duplicate CPF', phone: '11988880000', cpf: '52998224725',
    }), { status: 409 });
    assert.equal((await customers.findByPhone(a.tenantId, '11999990000')).id, a.customerId);
    assert.equal((await customers.findByPhone(b.tenantId, '11999990000')).id, b.customerId);
  });

  await context.test('concurrent retries commit one sale and one event with exact currency', async () => {
    const dto = payload();
    const [first, second] = await Promise.all([
      sales.create(a.tenantId, a.staffId, dto), sales.create(a.tenantId, a.staffId, dto),
    ]);
    assert.equal(first.id, second.id);
    assert.equal(first.amount.toFixed(2), '0.30');
    assert.equal(await prisma.transaction.count({ where: { tenantId: a.tenantId, idempotencyKey: dto.idempotencyKey } }), 1);
    assert.equal(await prisma.outboxEvent.count({ where: { tenantId: a.tenantId, transactionId: first.id } }), 1);
    await assert.rejects(sales.create(a.tenantId, a.staffId, { ...dto, customerId: undefined }), { status: 409 });
  });

  await context.test('separate purchases during the same day each create a pending points event', async () => {
    const first = await sales.create(a.tenantId, a.staffId, payload());
    const second = await sales.create(a.tenantId, a.staffId, payload());
    assert.equal(await prisma.outboxEvent.count({
      where: { tenantId: a.tenantId, transactionId: { in: [first.id, second.id] }, processedAt: null },
    }), 2);
    assert.equal((await customers.findById(a.tenantId, a.customerId)).points, 0);
  });

  await context.test('services reject resources and staff from another store', async () => {
    await assert.rejects(sales.create(a.tenantId, a.staffId, payload({ customerId: b.customerId })), { status: 404 });
    await assert.rejects(sales.create(a.tenantId, a.staffId, payload({
      items: [{ productId: b.productId, quantity: 3, unitPrice: 0.1 }],
    })), { status: 404 });
    await assert.rejects(sales.create(a.tenantId, b.staffId, payload()), { status: 401 });
  });

  await context.test('database foreign keys reject cross-tenant customer, staff and product writes', async () => {
    const foreignKeyFailure = (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
    for (const data of [
      { tenantId: a.tenantId, customerId: b.customerId, amount: 1, type: 'SALE' },
      { tenantId: a.tenantId, createdById: b.staffId, amount: 1, type: 'SALE' },
      {
        tenantId: a.tenantId, amount: 1, type: 'SALE',
        items: { create: { tenantId: a.tenantId, productId: b.productId, name: 'Foreign', quantity: 1, unitPrice: 1 } },
      },
    ]) {
      await assert.rejects(prisma.transaction.create({ data }), foreignKeyFailure);
    }
    const sale = await sales.create(a.tenantId, a.staffId, payload());
    await assert.rejects(prisma.outboxEvent.create({ data: {
      tenantId: b.tenantId, transactionId: sale.id, type: 'invalid', payload: {},
    } }), foreignKeyFailure);
  });

  await context.test('an actual outbox write failure rolls back the sale and its items', async () => {
    const failingDatabase = prisma.$extends({
      query: { outboxEvent: { async create() { throw new Error('Injected outbox failure'); } } },
    }) as unknown as PrismaService;
    const failingSales = new SalesService(failingDatabase, customers);
    const dto = payload();
    const before = await prisma.transactionItem.count({ where: { tenantId: a.tenantId } });
    await assert.rejects(failingSales.create(a.tenantId, a.staffId, dto), /Injected outbox failure/);
    assert.equal(await prisma.transaction.count({ where: { tenantId: a.tenantId, idempotencyKey: dto.idempotencyKey } }), 0);
    assert.equal(await prisma.transactionItem.count({ where: { tenantId: a.tenantId } }), before);
  });
});
