import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { GoalType, Mission, MissionStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { MissionsModule } from '@modules/missions/missions.module';
import { MissionsService } from '@modules/missions/missions.service';

interface HttpResult { status: number; body: unknown }

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function stringField(value: unknown, key: string): string {
  const field = record(value)[key];
  assert.ok(typeof field === 'string');
  return field;
}

function memoryMissions() {
  const rows: Mission[] = [];
  function scope(where?: Prisma.MissionWhereInput): string {
    if (typeof where?.tenantId !== 'string' || !where.tenantId) throw new Error('Missing tenant scope');
    return where.tenantId;
  }
  function publicMission(row: Mission) {
    const { description: _description, ...response } = row;
    return response;
  }
  const mission = {
    create: async ({ data }: Prisma.MissionCreateArgs) => {
      if (!data.tenantId) throw new Error('Missing tenant on create');
      const target = data.targetValue;
      if (!(target instanceof Prisma.Decimal) && typeof target !== 'number' && typeof target !== 'string') {
        throw new Error('Unsupported target');
      }
      const row: Mission = {
        id: randomUUID(), tenantId: data.tenantId, name: data.name,
        description: data.description ?? null, goalType: data.goalType,
        targetValue: new Prisma.Decimal(target), reward: data.reward,
        status: data.status ?? MissionStatus.ACTIVE,
        expiresAt: data.expiresAt == null ? null : new Date(data.expiresAt),
        createdAt: new Date(Date.now() + rows.length),
      };
      rows.push(row);
      return publicMission(row);
    },
    findMany: async ({ where }: Prisma.MissionFindManyArgs) => {
      const tenantId = scope(where);
      return rows.filter((row) => row.tenantId === tenantId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .map(publicMission);
    },
    update: async ({ where, data }: Prisma.MissionUpdateArgs) => {
      const tenantId = scope(where);
      const row = rows.find((entry) => entry.tenantId === tenantId && entry.id === where.id);
      if (!row) throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025', clientVersion: 'test',
      });
      if (typeof data.status !== 'string') throw new Error('Missing status');
      row.status = data.status;
      return publicMission(row);
    },
  };
  return { rows, database: { mission } };
}

test('missions HTTP API enforces tenant isolation and goal-specific validation', async (context) => {
  const { rows, database } = memoryMissions();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({
      isGlobal: true, ignoreEnvFile: true,
      load: [() => ({ JWT_SECRET: 'missions-test-secret', JWT_EXPIRATION: '1h' })],
    }),
    MissionsModule,
  ] }).overrideProvider(PrismaService).useValue(database).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useLogger(false);
  await app.listen(0);
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jwt = module.get(JwtService);
  const tokenA = await jwt.signAsync({ sub: randomUUID(), tenantId: tenantA, role: 'B2B', userRole: 'OWNER' });
  const tokenB = await jwt.signAsync({ sub: randomUUID(), tenantId: tenantB, role: 'B2B', userRole: 'OWNER' });
  const request = async (
    method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, token: string | null = tokenA,
  ): Promise<HttpResult> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    return { status: response.status, body: payload };
  };
  const valid = { name: 'Três visitas', goalType: 'VISITS', targetValue: 3, reward: 'Um café' };
  let missionA = '';
  let missionB = '';

  await context.test('all routes require a valid JWT', async () => {
    const id = randomUUID();
    assert.equal((await request('POST', '/missions', valid, null)).status, 401);
    assert.equal((await request('GET', '/missions', undefined, null)).status, 401);
    assert.equal((await request('PATCH', `/missions/${id}/status`, { status: 'INACTIVE' }, null)).status, 401);
    const expired = await jwt.signAsync({ sub: randomUUID(), tenantId: tenantA, role: 'B2B', userRole: 'OWNER' }, { expiresIn: -1 });
    assert.equal((await request('GET', '/missions', undefined, expired)).status, 401);
  });

  await context.test('creates a permanent visit mission with server-controlled tenant/status', async () => {
    const result = await request('POST', '/missions', { ...valid, name: '  Três visitas  ', reward: '  Um café  ' });
    assert.equal(result.status, 201);
    missionA = stringField(result.body, 'id');
    const body = record(result.body);
    assert.equal(body.name, valid.name);
    assert.equal(body.reward, valid.reward);
    assert.equal(body.tenantId, tenantA);
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.targetValue, '3');
    assert.equal(body.goalType, 'VISITS');
    assert.equal(body.expiresAt, null);
    assert.equal('title' in body, false);
  });

  await context.test('creates amount goals with exact decimal targets and optional expiration', async () => {
    const expiresAt = '2027-01-31T23:59:59.000Z';
    const result = await request('POST', '/missions', {
      ...valid, goalType: 'AMOUNT', targetValue: 49.9, expiresAt,
    });
    assert.equal(result.status, 201);
    assert.equal(record(result.body).targetValue, '49.9');
    assert.equal(record(result.body).expiresAt, expiresAt);
    assert.equal((await request('POST', '/missions', {
      ...valid, goalType: 'AMOUNT', targetValue: 0.01, expiresAt: null,
    })).status, 201);
    const foreign = await request('POST', '/missions', valid, tokenB);
    assert.equal(foreign.status, 201);
    missionB = stringField(foreign.body, 'id');
  });

  await context.test('rejects missing fields, fractional visits, invalid amounts and client-owned tenant claims', async () => {
    const invalid: Record<string, unknown>[] = [
      { name: undefined }, { name: null }, { name: '  ' }, { name: 'x'.repeat(121) },
      { goalType: undefined }, { goalType: 'POINTS' }, { goalType: 'visits' },
      { targetValue: undefined }, { targetValue: null }, { targetValue: '3' }, { targetValue: 1.5 },
      { targetValue: 0 }, { targetValue: -1 }, { targetValue: 10_000_000_000 },
      { goalType: 'AMOUNT', targetValue: 1.001 }, { goalType: 'AMOUNT', targetValue: 0 },
      { goalType: 'AMOUNT', targetValue: -1 }, { goalType: 'AMOUNT', targetValue: '19.90' },
      { reward: undefined }, { reward: '  ' }, { reward: 'x'.repeat(1001) },
      { expiresAt: 'not-a-date' }, { expiresAt: '2026-02-30T12:00:00Z' },
      { tenantId: tenantB }, { status: 'INACTIVE' }, { title: 'Injected name' }, { description: 'Unexpected field' },
    ];
    const before = rows.length;
    for (const changes of invalid) {
      const result = await request('POST', '/missions', { ...valid, ...changes });
      assert.equal(result.status, 400, JSON.stringify(changes));
    }
    assert.equal(rows.length, before);
  });

  await context.test('lists only the authenticated store, even with a tenant override in the URL', async () => {
    const first = await request('GET', `/missions?tenantId=${tenantB}`);
    assert.equal(first.status, 200);
    assert.ok(Array.isArray(first.body));
    assert.equal(first.body.length, 3);
    for (const row of first.body) assert.equal(record(row).tenantId, tenantA);
    const second = await request('GET', '/missions', undefined, tokenB);
    assert.ok(Array.isArray(second.body));
    assert.equal(second.body.length, 1);
    assert.equal(record(second.body[0]).id, missionB);
  });

  await context.test('status is set explicitly and repeated requests preserve the requested state', async () => {
    const path = `/missions/${missionA}/status`;
    assert.equal(record((await request('PATCH', path, { status: 'INACTIVE' })).body).status, 'INACTIVE');
    assert.equal(record((await request('PATCH', path, { status: 'INACTIVE' })).body).status, 'INACTIVE');
    assert.equal(record((await request('PATCH', path, { status: 'ACTIVE' })).body).status, 'ACTIVE');
  });

  await context.test('cross-tenant updates return the same 404 as a nonexistent mission', async () => {
    const foreign = await request('PATCH', `/missions/${missionB}/status`, { status: 'INACTIVE' });
    const missing = await request('PATCH', `/missions/${randomUUID()}/status`, { status: 'INACTIVE' });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.equal(rows.find((row) => row.id === missionB)?.status, 'ACTIVE');
  });

  await context.test('PATCH rejects arbitrary status, extra fields and malformed IDs', async () => {
    for (const body of [
      {}, { status: null }, { status: 'EXPIRED' }, { status: 'active' },
      { status: 'ACTIVE', tenantId: tenantB }, { status: 'ACTIVE', targetValue: 99 },
    ]) assert.equal((await request('PATCH', `/missions/${missionA}/status`, body)).status, 400);
    assert.equal((await request('PATCH', '/missions/invalid-id/status', { status: 'ACTIVE' })).status, 400);
  });

  await context.test('all internal service entry points reject absent tenant context', async () => {
    const service = module.get(MissionsService);
    await assert.rejects(service.findAll(''), { status: 401 });
    await assert.rejects(service.create('', { ...valid, goalType: GoalType.VISITS }), { status: 401 });
    await assert.rejects(service.updateStatus('', missionA, { status: MissionStatus.ACTIVE }), { status: 401 });
  });
});

test('PostgreSQL mission persistence, decimal constraints and scoped status updates', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const ids = [randomUUID(), randomUUID()];
  const module = await Test.createTestingModule({
    providers: [MissionsService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  const service = module.get(MissionsService);
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await module.close();
      await prisma.$disconnect();
    }
  });
  for (const id of ids) await prisma.tenant.create({ data: { id, name: 'Missions test', slug: `missions-${id}` } });
  const [tenantId, foreignTenantId] = ids;
  const first = await service.create(tenantId, {
    name: 'Visit challenge', goalType: GoalType.VISITS, targetValue: 3, reward: 'Benefit',
  });
  const second = await service.create(foreignTenantId, {
    name: 'Spend challenge', goalType: GoalType.AMOUNT, targetValue: 99.9, reward: 'Benefit',
  });
  assert.equal(first.expiresAt, null);
  assert.equal(second.targetValue.toFixed(2), '99.90');
  assert.deepEqual((await service.findAll(tenantId)).map((row) => row.id), [first.id]);
  await assert.rejects(service.updateStatus(tenantId, second.id, { status: MissionStatus.INACTIVE }), { status: 404 });
  assert.equal((await service.updateStatus(tenantId, first.id, { status: MissionStatus.INACTIVE })).status, 'INACTIVE');
  assert.equal((await prisma.mission.findFirstOrThrow({ where: { tenantId: foreignTenantId, id: second.id } })).status, 'ACTIVE');
  for (const targetValue of [0, -1, 1.5]) {
    await assert.rejects(prisma.mission.create({ data: {
      tenantId, name: 'Invalid visit target', goalType: GoalType.VISITS, targetValue, reward: 'Invalid',
    } }));
  }
});
