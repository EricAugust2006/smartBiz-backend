import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CustomerMissionStatus, GoalType, Mission, MissionStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { B2cDashboardModule } from '@modules/b2c-dashboard/b2c-dashboard.module';
import { B2cDashboardService } from '@modules/b2c-dashboard/b2c-dashboard.service';
import { MissionsModule } from '@modules/missions/missions.module';

const SECRET = 'b2c-dashboard-test-secret';
const DAY = 86_400_000;

function signToken(claims: Record<string, unknown>, secret = SECRET, algorithm = 'HS256'): string {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = createHmac(algorithm === 'HS512' ? 'sha512' : 'sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function dashboardMissions(body: unknown): Record<string, unknown>[] {
  const missions = record(body).missions;
  assert.ok(Array.isArray(missions));
  return (missions as unknown[]).map(record);
}

interface ProgressRow {
  tenantId: string; customerId: string; missionId: string; visits: number; status: CustomerMissionStatus;
}
interface SaleRow {
  tenantId: string; customerId: string; type: string; amount: Prisma.Decimal; createdAt: Date;
}

function dashboardFixture() {
  const tenantId = randomUUID();
  const foreignTenantId = randomUUID();
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const foreignCustomerId = randomUUID();
  const initialCustomers = [
    { id: customerId, tenantId, name: 'Ana', phone: '+5511999990000', points: 42, cpf: 'private' },
    { id: otherCustomerId, tenantId, name: 'Outra cliente', phone: '+5511988880000', points: 999, cpf: 'private' },
    { id: foreignCustomerId, tenantId: foreignTenantId, name: 'Outra loja', phone: '+5511977770000', points: 700, cpf: 'private' },
  ];
  const state = {
    customers: initialCustomers.map((row) => ({ ...row })), missions: [] as Mission[],
    progress: [] as ProgressRow[], sales: [] as SaleRow[],
    reads: 0, rawCalls: 0, rawOverride: undefined as unknown,
  };
  function scope(where: { tenantId?: unknown } | undefined): string {
    assert.ok(typeof where?.tenantId === 'string' && where.tenantId);
    return where.tenantId;
  }
  const models = {
    customer: {
      findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
        state.reads++;
        const owner = scope(args.where);
        assert.ok(typeof args.where?.id === 'string' && args.where.id);
        return state.customers.find((row) => row.tenantId === owner && row.id === args.where?.id) ?? null;
      },
    },
    mission: {
      findMany: async (args: Prisma.MissionFindManyArgs) => {
        state.reads++;
        const owner = scope(args.where);
        const nowFilter = args.where?.createdAt;
        assert.ok(typeof nowFilter === 'object' && nowFilter !== null && 'lte' in nowFilter && nowFilter.lte instanceof Date);
        const now = nowFilter.lte;
        const relation = args.select?.customers;
        assert.ok(typeof relation === 'object' && relation !== null);
        assert.equal(scope(relation.where), owner);
        assert.ok(typeof relation.where?.customerId === 'string');
        const selectedCustomerId = relation.where.customerId;
        return state.missions.filter((mission) => mission.tenantId === owner &&
          mission.status === args.where?.status && mission.createdAt <= now &&
          (mission.expiresAt === null || mission.expiresAt > now))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .map((mission) => ({ ...mission, customers: state.progress.filter((progress) =>
            progress.tenantId === owner && progress.customerId === selectedCustomerId && progress.missionId === mission.id) }));
      },
    },
    $queryRaw: async (query: Prisma.Sql): Promise<unknown> => {
      state.rawCalls++;
      assert.ok(query.text.includes('t."tenantId" = $1'));
      assert.ok(query.text.includes('t."customerId" = $2'));
      assert.ok(query.text.includes('m."tenantId" = $4'));
      const values: unknown[] = query.values;
      const [owner, customer, now, missionOwner, ...missionIds] = values;
      assert.ok(typeof owner === 'string' && typeof customer === 'string' && now instanceof Date);
      assert.equal(missionOwner, owner);
      if (state.rawOverride !== undefined) return state.rawOverride;
      return state.missions.filter((mission) => missionIds.includes(mission.id) && mission.tenantId === owner)
        .map((mission) => ({
          missionId: mission.id,
          amount: state.sales.filter((sale) => sale.tenantId === owner && sale.customerId === customer &&
            sale.type === 'SALE' && sale.amount.gt(0) && sale.createdAt >= mission.createdAt &&
            sale.createdAt <= now && (mission.expiresAt === null || sale.createdAt < mission.expiresAt))
            .reduce((sum, sale) => sum.plus(sale.amount), new Prisma.Decimal(0)),
        }));
    },
  };
  const database = {
    ...models,
    $transaction: async <Result>(
      operation: (client: typeof models) => Promise<Result>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ) => {
      assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.RepeatableRead);
      return operation(models);
    },
  };
  function mission(changes: Partial<Mission> = {}) {
    const row: Mission = {
      id: randomUUID(), tenantId, name: 'Visite três vezes', description: null,
      goalType: GoalType.VISITS, targetValue: new Prisma.Decimal(3), reward: 'Um café',
      status: MissionStatus.ACTIVE, createdAt: new Date(Date.now() - DAY), expiresAt: null,
      ...changes,
    };
    state.missions.push(row);
    return row;
  }
  function progress(missionId: string, visits: number, status: CustomerMissionStatus = CustomerMissionStatus.PENDING,
    customer = customerId, owner = tenantId) {
    state.progress.push({ tenantId: owner, customerId: customer, missionId, visits, status });
  }
  function sale(amount: string, createdAt = new Date(), changes: Partial<SaleRow> = {}) {
    state.sales.push({ tenantId, customerId, type: 'SALE', amount: new Prisma.Decimal(amount), createdAt, ...changes });
  }
  function reset() {
    state.customers = initialCustomers.map((row) => ({ ...row }));
    state.missions = []; state.progress = []; state.sales = [];
    state.reads = 0; state.rawCalls = 0; state.rawOverride = undefined;
  }
  return { database, state, tenantId, foreignTenantId, customerId, otherCustomerId, foreignCustomerId, mission, progress, sale, reset };
}

test('B2C dashboard authenticates customers and projects isolated real progress', async (context) => {
  const f = dashboardFixture();
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({
      isGlobal: true, ignoreEnvFile: true,
      load: [() => ({ JWT_SECRET: SECRET, JWT_EXPIRATION: '1h' })],
    }),
    B2cDashboardModule, MissionsModule,
  ] }).overrideProvider(PrismaService).useValue(f.database)
    .overrideProvider(ConfigService)
    .useValue({
      get: (key: string): string | undefined => {
        const values: Record<string, string> = { JWT_SECRET: SECRET, JWT_EXPIRATION: '1h' };
        return values[key];
      },
    })
    .compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  await app.listen(0);
  context.after(() => app.close());
  context.beforeEach(() => f.reset());
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const claims = { sub: f.customerId, tenantId: f.tenantId, role: 'B2C' };
  const token = signToken(claims);
  const request = async (bearer: string | null = token, path = '/b2c/dashboard') => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
    const body: unknown = await response.json();
    return { status: response.status, body, cacheControl: response.headers.get('cache-control') };
  };

  await context.test('requires valid B2C claims, expiry, signature and the expected algorithm', async () => {
    const invalid = [
      null, 'invalid', signToken(claims, 'wrong-secret'), signToken(claims, SECRET, 'HS512'),
      signToken({ ...claims, role: 'OWNER' }), signToken({ ...claims, role: 'STAFF' }),
      signToken({ ...claims, role: 'B2B', userRole: 'OWNER' }),
      signToken({ ...claims, role: undefined }), signToken({ ...claims, role: 'b2c' }),
      signToken({ ...claims, sub: undefined }), signToken({ ...claims, sub: '' }),
      signToken({ ...claims, tenantId: undefined }), signToken({ ...claims, tenantId: '' }),
      signToken({ ...claims, exp: undefined }), signToken({ ...claims, exp: 1 }),
    ];
    for (const bearer of invalid) assert.equal((await request(bearer)).status, 401);
    assert.equal(f.state.reads, 0);
  });

  await context.test('B2C tokens cannot open B2B mission management routes', async () => {
    assert.equal((await request(token, '/missions')).status, 401);
    assert.equal(f.state.reads, 0);
  });

  await context.test('returns only basic customer details and the materialized point balance', async () => {
    const result = await request();
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, 'private, no-store');
    assert.deepEqual(result.body, {
      customer: { id: f.customerId, tenantId: f.tenantId, name: 'Ana', phone: '+5511999990000' },
      pointsBalance: 42, missions: [],
    });
    assert.equal(f.state.rawCalls, 0);
  });

  await context.test('merges only this customer progress and defaults absent progress to zero', async () => {
    const active = f.mission();
    const untouched = f.mission({ name: 'Outra missão' });
    f.progress(active.id, 1);
    f.progress(active.id, 99, CustomerMissionStatus.PENDING, f.otherCustomerId);
    const missions = dashboardMissions((await request()).body);
    const current = missions.find((row) => row.id === active.id)!;
    assert.equal(current.goalType, 'VISITS');
    assert.equal(current.currentValue, 1);
    assert.equal(current.remainingValue, 2);
    assert.equal(current.targetValue, 3);
    assert.equal(current.isCompleted, false);
    assert.equal(current.expiresAt, null);
    assert.equal(missions.find((row) => row.id === untouched.id)?.currentValue, 0);
  });

  await context.test('filters inactive, expired, future and foreign-store missions', async () => {
    const visible = f.mission({ expiresAt: new Date(Date.now() + DAY) });
    f.mission({ status: MissionStatus.INACTIVE });
    f.mission({ status: MissionStatus.EXPIRED });
    f.mission({ expiresAt: new Date(Date.now() - 1) });
    f.mission({ createdAt: new Date(Date.now() + DAY) });
    f.mission({ tenantId: f.foreignTenantId });
    const missions = dashboardMissions((await request()).body);
    assert.deepEqual(missions.map((row) => row.id), [visible.id]);
    assert.equal(missions[0].expiresAt, visible.expiresAt?.toISOString());
  });

  await context.test('batches exact accumulated spend by mission period and ignores other customers/stores', async () => {
    const start = new Date(Date.now() - DAY);
    const amount = f.mission({ goalType: GoalType.AMOUNT, targetValue: new Prisma.Decimal(100), createdAt: start });
    const recentStart = new Date(Date.now() - 3600_000);
    const recent = f.mission({ goalType: GoalType.AMOUNT, targetValue: new Prisma.Decimal(1), createdAt: recentStart });
    f.sale('19.90', start);
    f.sale('0.10', new Date(Date.now() - 1000));
    f.sale('0.20', new Date(Date.now() - 500));
    f.sale('999', new Date(start.getTime() - 1));
    f.sale('999', new Date(Date.now() + DAY));
    f.sale('999', new Date(), { customerId: f.otherCustomerId });
    f.sale('999', new Date(), { tenantId: f.foreignTenantId });
    f.sale('999', new Date(), { type: 'REFUND' });
    f.sale('-10');
    const missions = dashboardMissions((await request()).body);
    const all = missions.find((row) => row.id === amount.id)!;
    const last = missions.find((row) => row.id === recent.id)!;
    assert.equal(all.currentValue, '20.20');
    assert.equal(all.targetValue, '100.00');
    assert.equal(all.remainingValue, '79.80');
    assert.equal(last.currentValue, '0.30');
    assert.equal(last.remainingValue, '0.70');
    assert.equal(f.state.rawCalls, 1);
  });

  await context.test('reports completion without negative remainder or persistence side effects', async () => {
    const exceeded = f.mission();
    const historical = f.mission({ targetValue: new Prisma.Decimal(99) });
    const amount = f.mission({ goalType: GoalType.AMOUNT, targetValue: new Prisma.Decimal(10) });
    f.progress(exceeded.id, 5);
    f.progress(historical.id, 0, CustomerMissionStatus.COMPLETED);
    f.sale('19.90', new Date(Date.now() - 1000));
    const before = f.state.progress.map((row) => ({ ...row }));
    const missions = dashboardMissions((await request()).body);
    for (const mission of missions) assert.equal(mission.isCompleted, true);
    assert.equal(missions.find((row) => row.id === exceeded.id)?.remainingValue, 0);
    assert.equal(missions.find((row) => row.id === historical.id)?.remainingValue, 0);
    assert.equal(missions.find((row) => row.id === amount.id)?.remainingValue, '0.00');
    assert.deepEqual(f.state.progress, before);
    assert.equal(f.state.customers[0].points, 42);
  });

  await context.test('URL identifiers never override the signed customer or store', async () => {
    const result = await request(token, `/b2c/dashboard?tenantId=${f.foreignTenantId}&customerId=${f.foreignCustomerId}&phone=other`);
    assert.equal(record(record(result.body).customer).id, f.customerId);
    const foreignToken = signToken({ sub: f.foreignCustomerId, tenantId: f.foreignTenantId, role: 'B2C' });
    const foreign = await request(foreignToken);
    assert.equal(record(record(foreign.body).customer).id, f.foreignCustomerId);
    assert.equal(record(foreign.body).pointsBalance, 700);
  });

  await context.test('foreign, missing and deleted customer contexts all return the same 404', async () => {
    const foreign = await request(signToken({ ...claims, sub: f.foreignCustomerId }));
    const missing = await request(signToken({ ...claims, sub: randomUUID() }));
    f.state.customers = f.state.customers.filter((row) => row.id !== f.customerId);
    const deleted = await request();
    assert.equal(foreign.status, 404);
    assert.equal(deleted.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.deepEqual(deleted.body, missing.body);
  });

  await context.test('absent internal identity fails closed before database access', async () => {
    const dashboard = module.get(B2cDashboardService);
    await assert.rejects(dashboard.getDashboard('', f.customerId), { status: 401 });
    await assert.rejects(dashboard.getDashboard(f.tenantId, ''), { status: 401 });
    assert.equal(f.state.reads, 0);
  });

  await context.test('an invalid monetary projection fails instead of returning invented progress', async () => {
    f.mission({ goalType: GoalType.AMOUNT });
    f.state.rawOverride = [{ missionId: 'unexpected-mission', amount: new Prisma.Decimal(100) }];
    assert.equal((await request()).status, 500);
  });
});

test('PostgreSQL B2C dashboard aggregates exact spend and keeps customer/tenant isolation', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const ids = [randomUUID(), randomUUID()];
  const module = await Test.createTestingModule({
    providers: [B2cDashboardService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  const dashboard = module.get(B2cDashboardService);
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await module.close();
      await prisma.$disconnect();
    }
  });
  const [tenantId, foreignTenantId] = ids;
  for (const id of ids) await prisma.tenant.create({ data: { id, name: 'Dashboard test', slug: `dashboard-${id}` } });
  const customer = await prisma.customer.create({ data: { tenantId, name: 'Ana', phone: '+5511999990000', points: 123 } });
  const other = await prisma.customer.create({ data: { tenantId, name: 'Other', phone: '+5511988880000' } });
  const foreign = await prisma.customer.create({ data: { tenantId: foreignTenantId, name: 'Foreign', phone: '+5511999990000' } });
  const start = new Date(Date.now() - DAY);
  const visits = await prisma.mission.create({ data: {
    tenantId, name: 'Visits', goalType: GoalType.VISITS, targetValue: 3, reward: 'Coffee', createdAt: start,
  } });
  const amount = await prisma.mission.create({ data: {
    tenantId, name: 'Spend', goalType: GoalType.AMOUNT, targetValue: 50, reward: 'Benefit', createdAt: start,
  } });
  await prisma.customerMission.createMany({ data: [
    { tenantId, customerId: customer.id, missionId: visits.id, visits: 1 },
    { tenantId, customerId: other.id, missionId: visits.id, visits: 99 },
  ] });
  await prisma.transaction.createMany({ data: [
    { tenantId, customerId: customer.id, type: 'SALE', amount: '19.90', createdAt: start },
    { tenantId, customerId: customer.id, type: 'SALE', amount: '0.10', createdAt: new Date(Date.now() - 1000) },
    { tenantId, customerId: customer.id, type: 'SALE', amount: '0.20', createdAt: new Date(Date.now() - 500) },
    { tenantId, customerId: customer.id, type: 'SALE', amount: '999', createdAt: new Date(start.getTime() - 1) },
    { tenantId, customerId: customer.id, type: 'REFUND', amount: '999', createdAt: start },
    { tenantId, customerId: other.id, type: 'SALE', amount: '999', createdAt: start },
    { tenantId: foreignTenantId, customerId: foreign.id, type: 'SALE', amount: '999', createdAt: start },
  ] });
  const result = await dashboard.getDashboard(tenantId, customer.id);
  assert.equal(result.customer.id, customer.id);
  assert.equal(result.pointsBalance, 123);
  assert.equal(result.missions.find((mission) => mission.id === visits.id)?.currentValue, 1);
  assert.equal(result.missions.find((mission) => mission.id === amount.id)?.currentValue, '20.20');
  assert.equal(result.missions.find((mission) => mission.id === amount.id)?.remainingValue, '29.80');
  await assert.rejects(dashboard.getDashboard(tenantId, foreign.id), { status: 404 });
  assert.equal((await prisma.customerMission.findFirstOrThrow({
    where: { tenantId, customerId: customer.id, missionId: visits.id },
  })).visits, 1);
});
