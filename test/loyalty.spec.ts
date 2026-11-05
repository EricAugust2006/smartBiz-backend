import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomerMissionStatus, GoalType, MissionStatus } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { LoyaltyOutboxConsumer } from '@modules/loyalty/loyalty-outbox.consumer';
import { loyaltyFixture } from './support/loyalty-prisma.fixture';

const DAY = 86_400_000;

test('loyalty rules, outbox recovery and tenant isolation', async (context) => {
  Logger.overrideLogger(false);
  async function setup() {
    const fixture = loyaltyFixture();
    const module = await Test.createTestingModule({ imports: [LoyaltyModule] })
      .overrideProvider(PrismaService).useValue(fixture.prisma).compile();
    context.after(() => module.close());
    return { ...fixture, loyalty: module.get(LoyaltyService), consumer: module.get(LoyaltyOutboxConsumer) };
  }

  await context.test('credits floor(amount), a ledger and a mission visit atomically', async () => {
    const f = await setup();
    const active = f.mission();
    const { event } = f.sale();
    assert.deepEqual(await f.loyalty.processEvent(f.tenantId, event.id), {
      status: 'processed', points: 19, visitCounted: true,
    });
    assert.equal(f.state.customers[0].points, 19);
    assert.equal(f.state.ledger[0].balanceAfter, 19);
    assert.equal(f.state.ledger[0].tenantId, f.tenantId);
    assert.equal(f.state.progress[0].missionId, active.id);
    assert.equal(f.state.progress[0].visits, 1);
    assert.ok(f.state.events[0].processedAt);
  });

  await context.test('replaying a processed event never credits it again', async () => {
    const f = await setup();
    f.mission();
    const { event } = f.sale();
    await f.loyalty.processEvent(f.tenantId, event.id);
    assert.deepEqual(await f.loyalty.processEvent(f.tenantId, event.id), { status: 'already_processed' });
    assert.equal(f.state.customers[0].points, 19);
    assert.equal(f.state.ledger.length, 1);
    assert.equal(f.state.progress[0].visits, 1);
  });

  await context.test('amounts below one real create a zero-points ledger and may count a visit', async () => {
    const f = await setup();
    const { event } = f.sale(f.now, '0.99');
    const result = await f.loyalty.processEvent(f.tenantId, event.id);
    assert.deepEqual(result, { status: 'processed', points: 0, visitCounted: true });
    assert.equal(f.state.ledger[0].points, 0);
  });

  for (const elapsed of [DAY - 1, DAY, DAY + 1]) {
    await context.test(`cooldown ${elapsed}ms still credits points and requires strictly more than 24h`, async () => {
      const f = await setup();
      f.mission();
      f.sale(new Date(f.now.getTime() - elapsed));
      const { event } = f.sale();
      const result = await f.loyalty.processEvent(f.tenantId, event.id);
      assert.deepEqual(result, { status: 'processed', points: 19, visitCounted: elapsed > DAY });
      assert.equal(f.state.customers[0].points, 19);
      assert.equal(f.state.progress.length, elapsed > DAY ? 1 : 0);
    });
  }

  await context.test('all previous purchases reset the window, including purchases without a counted visit', async () => {
    const f = await setup();
    f.mission();
    f.sale(new Date(f.now.getTime() - 2 * DAY));
    f.sale(new Date(f.now.getTime() - 1000));
    const { event } = f.sale();
    assert.deepEqual(await f.loyalty.processEvent(f.tenantId, event.id), {
      status: 'processed', points: 19, visitCounted: false,
    });
  });

  await context.test('future sales do not suppress historical visits and timestamps never move backward', async () => {
    const f = await setup();
    f.mission();
    const first = f.sale(new Date(f.now.getTime() - 2 * DAY));
    const second = f.sale();
    await f.loyalty.processEvent(f.tenantId, second.event.id);
    await f.loyalty.processEvent(f.tenantId, first.event.id);
    assert.equal(f.state.customers[0].points, 38);
    assert.equal(f.state.progress[0].visits, 2);
    assert.equal(f.state.progress[0].lastVisitAt?.getTime(), f.now.getTime());
  });

  await context.test('millisecond ties have a deterministic single eligible visit', async () => {
    const f = await setup();
    f.mission();
    const first = f.sale(f.now, '10', f.tenantId, '00000000-0000-4000-8000-000000000001');
    const second = f.sale(f.now, '10', f.tenantId, '00000000-0000-4000-8000-000000000002');
    await f.loyalty.processEvent(f.tenantId, second.event.id);
    await f.loyalty.processEvent(f.tenantId, first.event.id);
    assert.equal(f.state.progress[0].visits, 1);
    assert.equal(f.state.customers[0].points, 20);
  });

  await context.test('a late committed sale with the same timestamp cannot count a second visit', async () => {
    const f = await setup();
    f.mission();
    const first = f.sale(f.now, '10', f.tenantId, '00000000-0000-4000-8000-000000000002');
    await f.loyalty.processEvent(f.tenantId, first.event.id);
    const late = f.sale(f.now, '10', f.tenantId, '00000000-0000-4000-8000-000000000001');
    await f.loyalty.processEvent(f.tenantId, late.event.id);
    assert.equal(f.state.progress[0].visits, 1);
    assert.equal(f.state.customers[0].points, 20);
  });

  await context.test('only active missions in the purchase period advance; completed progress stays unchanged', async () => {
    const f = await setup();
    const active = f.mission();
    f.mission({ status: MissionStatus.INACTIVE });
    f.mission({ status: MissionStatus.EXPIRED });
    f.mission({ expiresAt: f.now });
    f.mission({ createdAt: new Date(f.now.getTime() + 1) });
    f.mission({ tenantId: f.otherTenantId });
    const completed = f.mission();
    f.state.progress.push({
      id: 'completed', tenantId: f.tenantId, customerId: f.customerId, missionId: completed.id,
      visits: 3, lastVisitAt: null, status: CustomerMissionStatus.COMPLETED,
    });
    const { event } = f.sale();
    await f.loyalty.processEvent(f.tenantId, event.id);
    assert.equal(f.state.progress.length, 2);
    assert.equal(f.state.progress.find((row) => row.missionId === active.id)?.visits, 1);
    assert.equal(f.state.progress.find((row) => row.missionId === completed.id)?.visits, 3);
  });

  await context.test('permanent visit missions advance and amount missions do not receive visit counters', async () => {
    const f = await setup();
    const permanent = f.mission({ expiresAt: null });
    f.mission({ goalType: GoalType.AMOUNT, expiresAt: null });
    f.mission({ goalType: GoalType.AMOUNT });
    const { event } = f.sale();
    await f.loyalty.processEvent(f.tenantId, event.id);
    assert.equal(f.state.progress.length, 1);
    assert.equal(f.state.progress[0].missionId, permanent.id);
    assert.equal(f.state.progress[0].visits, 1);
  });

  await context.test('cross-tenant events and sales are invisible and cross-tenant history does not block', async () => {
    const f = await setup();
    const foreign = f.sale(new Date(f.now.getTime() - 1000), '10', f.otherTenantId);
    await assert.rejects(f.loyalty.processEvent(f.tenantId, foreign.event.id), { status: 404 });
    const { event } = f.sale();
    assert.deepEqual(await f.loyalty.processEvent(f.tenantId, event.id), {
      status: 'processed', points: 19, visitCounted: true,
    });
    const poisoned = f.sale();
    poisoned.event.transactionId = foreign.sale.id;
    await assert.rejects(f.loyalty.processEvent(f.tenantId, poisoned.event.id), { status: 404 });
    assert.equal(f.state.ledger.length, 1);
  });

  await context.test('a ledger failure rolls back balance, progress and event completion; retry recovers', async () => {
    const f = await setup();
    f.mission();
    const { event } = f.sale();
    f.state.failLedger = true;
    await assert.rejects(f.loyalty.processEvent(f.tenantId, event.id), /Injected ledger failure/);
    assert.equal(f.state.customers[0].points, 0);
    assert.equal(f.state.progress.length, 0);
    assert.equal(f.state.events[0].processedAt, null);
    f.state.failLedger = false;
    await f.loyalty.processEvent(f.tenantId, event.id);
    assert.equal(f.state.customers[0].points, 19);
    assert.equal(f.state.ledger.length, 1);
  });

  await context.test('serialization failures retry without duplicating committed effects', async () => {
    const f = await setup();
    const { event } = f.sale();
    f.state.conflicts = 2;
    await f.loyalty.processEvent(f.tenantId, event.id);
    assert.equal(f.state.transactionAttempts, 3);
    assert.equal(f.state.ledger.length, 1);
    f.state.conflicts = 10;
    const second = f.sale();
    await assert.rejects(f.loyalty.processEvent(f.tenantId, second.event.id), { code: 'P2034' });
    assert.equal(f.state.transactionAttempts, 8);
    assert.equal(f.state.ledger.length, 1);
  });

  await context.test('integer overflow and missing tenant context fail without losing the event', async () => {
    const f = await setup();
    const { event } = f.sale();
    f.state.customers[0].points = 2_147_483_647;
    await assert.rejects(f.loyalty.processEvent(f.tenantId, event.id), { status: 400 });
    assert.equal(f.state.customers[0].points, 2_147_483_647);
    assert.equal(f.state.events[0].processedAt, null);
    await assert.rejects(f.loyalty.processEvent('', event.id), { status: 401 });
    await assert.rejects(f.consumer.processTenant(''), { status: 401 });
  });

  await context.test('the consumer processes only due events in the requested tenant', async () => {
    const f = await setup();
    const due = f.sale();
    const deferred = f.sale();
    deferred.event.nextAttemptAt = new Date(Date.now() + DAY);
    const foreign = f.sale(f.now, '10', f.otherTenantId);
    assert.equal(await f.consumer.processTenant(f.tenantId), 1);
    assert.ok(f.state.events.find((row) => row.id === due.event.id)?.processedAt);
    assert.equal(f.state.events.find((row) => row.id === deferred.event.id)?.processedAt, null);
    assert.equal(f.state.events.find((row) => row.id === foreign.event.id)?.processedAt, null);
    assert.equal(await f.consumer.processTenant(f.tenantId), 0);
  });

  await context.test('a failed event gets persistent backoff while healthy events continue', async () => {
    const f = await setup();
    const broken = f.sale(new Date(f.now.getTime() - 1000));
    broken.sale.type = 'REFUND';
    const valid = f.sale();
    assert.equal(await f.consumer.processTenant(f.tenantId), 1);
    const failed = f.state.events.find((row) => row.id === broken.event.id)!;
    assert.equal(failed.processedAt, null);
    assert.equal(failed.attempts, 1);
    assert.ok(failed.nextAttemptAt.getTime() > Date.now());
    assert.equal(failed.lastError, 'Sale not found.');
    assert.ok(f.state.events.find((row) => row.id === valid.event.id)?.processedAt);
  });
});
