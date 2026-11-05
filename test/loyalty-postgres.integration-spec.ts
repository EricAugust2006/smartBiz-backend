import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { LoyaltyOutboxConsumer } from '@modules/loyalty/loyalty-outbox.consumer';

const DAY = 86_400_000;

test('PostgreSQL loyalty atomicity, concurrency, immutable ledger and tenant constraints', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  Logger.overrideLogger(false);
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const tenantIds = [randomUUID(), randomUUID()];
  const module = await Test.createTestingModule({ imports: [LoyaltyModule] })
    .overrideProvider(PrismaService).useValue(prisma).compile();
  const loyalty = module.get(LoyaltyService);
  const consumer = module.get(LoyaltyOutboxConsumer);
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    } finally {
      await module.close();
      await prisma.$disconnect();
    }
  });
  await prisma.$connect();
  const [tenantId, otherTenantId] = tenantIds;
  const base = new Date('2026-11-03T12:00:00.000Z');
  let customerSequence = 0;
  for (const id of tenantIds) {
    await prisma.tenant.create({ data: { id, name: 'Loyalty integration', slug: `loyalty-${id}` } });
  }
  const activeMission = await prisma.mission.create({ data: {
    tenantId, name: 'Visits', goalType: 'VISITS', targetValue: 3,
    description: 'Integration mission', reward: 'Benefit',
    createdAt: new Date(base.getTime() - 365 * DAY), expiresAt: new Date(base.getTime() + 365 * DAY),
  } });

  async function customer(owner = tenantId) {
    return prisma.customer.create({ data: {
      tenantId: owner, name: 'Loyalty test', phone: `+55${11900000000 + customerSequence++}`,
    } });
  }

  async function sale(owner: string, customerId: string, createdAt = base, amount = '19.90') {
    return prisma.$transaction(async (database) => {
      const purchase = await database.transaction.create({ data: {
        tenantId: owner, customerId, type: 'SALE', amount: new Prisma.Decimal(amount), createdAt,
      } });
      const event = await database.outboxEvent.create({ data: {
        tenantId: owner, transactionId: purchase.id, type: 'sale.confirmed',
        payload: { tenantId: owner, saleId: purchase.id, customerId, amount },
      } });
      return { purchase, event };
    });
  }

  await context.test('concurrent deliveries of one event credit once and finish the outbox once', async () => {
    const client = await customer();
    const { purchase, event } = await sale(tenantId, client.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => loyalty.processEvent(tenantId, event.id)));
    assert.equal(results.filter((result) => result.status === 'processed').length, 1);
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { tenantId, id: client.id } })).points, 19);
    const ledger = await prisma.pointsLedger.findMany({ where: { tenantId, transactionId: purchase.id } });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].balanceAfter, 19);
    assert.equal((await prisma.customerMission.findFirstOrThrow({
      where: { tenantId, customerId: client.id, missionId: activeMission.id },
    })).visits, 1);
    assert.ok((await prisma.outboxEvent.findFirstOrThrow({ where: { tenantId, id: event.id } })).processedAt);
  });

  await context.test('different concurrent purchases preserve the balance and apply one cooldown visit', async () => {
    const client = await customer();
    const first = await sale(tenantId, client.id, base, '10.99');
    const second = await sale(tenantId, client.id, new Date(base.getTime() + 1000), '5.99');
    await Promise.all([loyalty.processEvent(tenantId, first.event.id), loyalty.processEvent(tenantId, second.event.id)]);
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { tenantId, id: client.id } })).points, 15);
    assert.equal(await prisma.pointsLedger.count({ where: { tenantId, customerId: client.id } }), 2);
    assert.equal((await prisma.customerMission.findFirstOrThrow({ where: { tenantId, customerId: client.id } })).visits, 1);
  });

  await context.test('strict 24-hour boundary and out-of-order processing use purchase timestamps', async () => {
    for (const elapsed of [DAY, DAY + 1]) {
      const client = await customer();
      const first = await sale(tenantId, client.id, new Date(base.getTime() - elapsed));
      const second = await sale(tenantId, client.id);
      await loyalty.processEvent(tenantId, second.event.id);
      await loyalty.processEvent(tenantId, first.event.id);
      assert.equal((await prisma.customer.findFirstOrThrow({ where: { tenantId, id: client.id } })).points, 38);
      const progress = await prisma.customerMission.findFirstOrThrow({ where: { tenantId, customerId: client.id } });
      assert.equal(progress.visits, elapsed > DAY ? 2 : 1);
    }
  });

  await context.test('a real transaction rolls back every effect when ledger creation fails', async () => {
    const client = await customer();
    const { event } = await sale(tenantId, client.id);
    const failingClient = prisma.$extends({
      query: { pointsLedger: { async create() { throw new Error('Injected ledger failure'); } } },
    });
    const failingModule = await Test.createTestingModule({
      providers: [LoyaltyService, { provide: PrismaService, useValue: failingClient }],
    }).compile();
    try {
      await assert.rejects(failingModule.get(LoyaltyService).processEvent(tenantId, event.id), /Injected ledger failure/);
    } finally {
      await failingModule.close();
    }
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { tenantId, id: client.id } })).points, 0);
    assert.equal(await prisma.pointsLedger.count({ where: { tenantId, customerId: client.id } }), 0);
    assert.equal(await prisma.customerMission.count({ where: { tenantId, customerId: client.id } }), 0);
    assert.equal((await prisma.outboxEvent.findFirstOrThrow({ where: { tenantId, id: event.id } })).processedAt, null);
    await loyalty.processEvent(tenantId, event.id);
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { tenantId, id: client.id } })).points, 19);
  });

  await context.test('ledger updates/deletes and duplicate sale entries are rejected by PostgreSQL', async () => {
    const client = await customer();
    const { purchase, event } = await sale(tenantId, client.id);
    await loyalty.processEvent(tenantId, event.id);
    await assert.rejects(prisma.pointsLedger.updateMany({
      where: { tenantId, transactionId: purchase.id }, data: { points: 999 },
    }));
    await assert.rejects(prisma.pointsLedger.deleteMany({ where: { tenantId, transactionId: purchase.id } }));
    await assert.rejects(prisma.pointsLedger.create({ data: {
      tenantId, customerId: client.id, transactionId: purchase.id, eventId: event.id,
      points: 19, balanceAfter: 38, visitCounted: true,
    } }), { code: 'P2002' });
    assert.equal((await prisma.pointsLedger.findFirstOrThrow({ where: { tenantId, transactionId: purchase.id } })).points, 19);
  });

  await context.test('cross-tenant events are invisible and composite progress/ledger links cannot cross stores', async () => {
    const client = await customer();
    const foreignClient = await customer(otherTenantId);
    const local = await sale(tenantId, client.id);
    const foreign = await sale(otherTenantId, foreignClient.id);
    await assert.rejects(loyalty.processEvent(tenantId, foreign.event.id), { status: 404 });
    await assert.rejects(prisma.customerMission.create({ data: {
      tenantId: otherTenantId, customerId: foreignClient.id, missionId: activeMission.id,
    } }), { code: 'P2003' });
    const baseData = {
      tenantId, customerId: client.id, transactionId: local.purchase.id,
      eventId: local.event.id, points: 19, balanceAfter: 19, visitCounted: true,
    };
    for (const data of [
      { ...baseData, customerId: foreignClient.id },
      { ...baseData, transactionId: foreign.purchase.id },
      { ...baseData, eventId: foreign.event.id },
    ]) await assert.rejects(prisma.pointsLedger.create({ data }), { code: 'P2003' });
  });

  await context.test('consumer resumes persisted events and retains failed events with backoff', async () => {
    const client = await customer();
    const healthy = await sale(tenantId, client.id);
    const broken = await sale(tenantId, client.id);
    await prisma.transaction.updateMany({ where: { tenantId, id: broken.purchase.id }, data: { type: 'REFUND' } });
    await consumer.processTenant(tenantId);
    assert.equal(await prisma.pointsLedger.count({ where: { tenantId, transactionId: healthy.purchase.id } }), 1);
    const failed = await prisma.outboxEvent.findFirstOrThrow({ where: { tenantId, id: broken.event.id } });
    assert.equal(failed.processedAt, null);
    assert.equal(failed.attempts, 1);
    assert.ok(failed.nextAttemptAt.getTime() > Date.now());
  });
});
