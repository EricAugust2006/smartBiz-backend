import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { CustomersModule } from '../src/modules/customers/customers.module';
import { CustomersService } from '../src/modules/customers/customers.service';
import { SalesModule } from '../src/modules/sales/sales.module';

type Row = Record<string, any>;

function uniqueError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002', clientVersion: 'test',
  });
}

function matches(row: Row, where: Row) {
  return Object.entries(where).every(([key, value]) =>
    typeof value === 'object' && value !== null ? value.in.includes(row[key]) : row[key] === value,
  );
}

function select(row: Row | undefined, selection?: Row): any {
  if (!row) return null;
  if (!selection) return { ...row };
  return Object.fromEntries(Object.entries(selection).map(([key, value]) => [
    key, value === true ? row[key] : row[key].map((item: Row) => select(item, value.select)),
  ]));
}

function memoryDatabase() {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const staffA = randomUUID();
  const staffB = randomUUID();
  const productA = { id: randomUUID(), tenantId: tenantA, name: 'Café' };
  const productB = { id: randomUUID(), tenantId: tenantB, name: 'Outro café' };
  const state = {
    customers: [] as Row[], sales: [] as Row[], events: [] as Row[],
    users: [{ id: staffA, tenantId: tenantA }, { id: staffB, tenantId: tenantB }],
    failEvent: false,
  };
  const database = {
    customer: {
      create: async ({ data }: Row) => {
        if (state.customers.some((row) => row.tenantId === data.tenantId &&
          (row.phone === data.phone || (data.cpf && row.cpf === data.cpf)))) throw uniqueError();
        const row = {
          id: randomUUID(), ...data, cpf: data.cpf ?? null,
          tier: 'BRONZE', isVipMember: false, points: 0, createdAt: new Date(),
        };
        state.customers.push(row);
        return { ...row };
      },
      findFirst: async ({ where }: Row) => select(state.customers.find((row) => matches(row, where))),
    },
    user: {
      findFirst: async ({ where, select: selection }: Row) =>
        select(state.users.find((row) => matches(row, where)), selection),
    },
    product: {
      findMany: async ({ where, select: selection }: Row) =>
        [productA, productB].filter((row) => matches(row, where)).map((row) => select(row, selection)),
    },
    transaction: {
      create: async ({ data, select: selection }: Row) => {
        if (state.sales.some((row) => row.tenantId === data.tenantId &&
          row.idempotencyKey === data.idempotencyKey)) throw uniqueError();
        const row = {
          ...data, id: randomUUID(), createdAt: new Date(), customerId: data.customerId ?? null,
          items: data.items.create,
        };
        state.sales.push(row);
        return select(row, selection);
      },
      findFirst: async ({ where, select: selection }: Row) =>
        select(state.sales.find((row) => matches(row, where)), selection),
    },
    outboxEvent: {
      create: async ({ data }: Row) => {
        if (state.failEvent) throw new Error('Simulated outbox failure');
        const row = { ...data, id: randomUUID() };
        state.events.push(row);
        return row;
      },
    },
    $transaction: async <T>(callback: (client: any) => Promise<T>): Promise<T> => {
      const snapshot = { sales: [...state.sales], events: [...state.events] };
      try {
        return await callback(database);
      } catch (error) {
        state.sales = snapshot.sales;
        state.events = snapshot.events;
        throw error;
      }
    },
  };
  return { database, state, tenantA, tenantB, staffA, staffB, productA, productB };
}

test('authenticated customer registration and sales stay within the staff tenant', async (context) => {
  const fixture = memoryDatabase();
  const { database, state, tenantA, tenantB, staffA, staffB, productA, productB } = fixture;
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true, ignoreEnvFile: true,
        load: [() => ({ JWT_SECRET: 'sales-test-secret', JWT_EXPIRATION: '1h' })],
      }),
      AuthModule, CustomersModule, SalesModule,
    ],
  }).overrideProvider(PrismaService).useValue(database).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useLogger(false);
  await app.listen(0);
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jwt = module.get(JwtService);
  const tokenA = await jwt.signAsync({ sub: staffA, tenantId: tenantA, role: 'B2B', userRole: 'STAFF' });
  const tokenB = await jwt.signAsync({ sub: staffB, tenantId: tenantB, role: 'B2B', userRole: 'OWNER' });
  const request = async (path: string, body?: unknown, token: string | null = tokenA) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const newCustomer = { name: 'Ana', phone: '(11) 99999-0000', cpf: '529.982.247-25' };
  const sale = (changes: Row = {}) => ({
    idempotencyKey: randomUUID(), amount: 19.9,
    items: [{ productId: productA.id, quantity: 2, unitPrice: 9.95 }], ...changes,
  });
  let customerA: Row;
  let customerB: Row;

  await context.test('requires JWT on all new routes', async () => {
    assert.equal((await request('/customers', newCustomer, null)).status, 401);
    assert.equal((await request('/customers/by-phone?phone=11999990000', undefined, null)).status, 401);
    assert.equal((await request('/sales', sale(), null)).status, 401);
  });

  await context.test('normalizes phone/CPF and scopes duplicate checks to the establishment', async () => {
    const first = await request('/customers', newCustomer);
    assert.equal(first.status, 201);
    customerA = first.body;
    assert.equal(customerA.phone, '+5511999990000');
    assert.equal(customerA.cpf, '52998224725');
    assert.equal(customerA.tenantId, tenantA);
    assert.equal((await request('/customers', newCustomer)).status, 409);
    assert.equal((await request('/customers', { ...newCustomer, phone: '11988880000' })).status, 409);
    const second = await request('/customers', newCustomer, tokenB);
    assert.equal(second.status, 201);
    customerB = second.body;
    assert.notEqual(customerA.id, customerB.id);
  });

  await context.test('looks up the phone only inside the authenticated tenant', async () => {
    const resultA = await request('/customers/by-phone?phone=11999990000');
    const resultB = await request('/customers/by-phone?phone=11999990000', undefined, tokenB);
    assert.equal(resultA.body.id, customerA.id);
    assert.equal(resultB.body.id, customerB.id);
    const unique = await request('/customers', { name: 'B only', phone: '11977770000' }, tokenB);
    assert.equal(unique.status, 201);
    assert.equal((await request('/customers/by-phone?phone=11977770000')).status, 404);
  });

  await context.test('rejects invalid identifiers and caller-controlled tenancy or points', async () => {
    for (const changes of [
      { cpf: '11111111111' }, { cpf: '52998224724' }, { phone: 'invalid11999990000' },
      { name: '  ' }, { tenantId: tenantB }, { points: 100 }, { isVipMember: true },
    ]) assert.equal((await request('/customers', { ...newCustomer, ...changes })).status, 400);
  });

  await context.test('persists exact sale totals, item snapshots, staff and pending loyalty event', async () => {
    const result = await request('/sales', sale({ customerPhone: newCustomer.phone }));
    assert.equal(result.status, 201);
    assert.equal(result.body.amount, '19.9');
    assert.equal(result.body.customerId, customerA.id);
    assert.equal(result.body.createdById, staffA);
    assert.equal(result.body.tenantId, tenantA);
    assert.equal(result.body.type, 'SALE');
    assert.equal(result.body.items[0].name, 'Café');
    assert.equal(result.body.items[0].unitPrice, '9.95');
    assert.equal('requestHash' in result.body, false);
    const event = state.events.find((row) => row.transactionId === result.body.id)!;
    assert.equal(event.tenantId, tenantA);
    assert.equal(event.payload.amount, '19.90');
    assert.equal(event.payload.customerId, customerA.id);
    assert.equal(customerA.points, 0);
  });

  await context.test('replaying a key returns the original sale without another event', async () => {
    const payload = sale({ customerId: customerA.id });
    const first = await request('/sales', payload);
    const count = state.sales.length;
    const eventCount = state.events.length;
    const repeated = await request('/sales', payload);
    assert.equal(repeated.status, 201);
    assert.equal(repeated.body.id, first.body.id);
    assert.equal(state.sales.length, count);
    assert.equal(state.events.length, eventCount);
    const different = await request('/sales', { ...payload, customerId: undefined });
    assert.equal(different.status, 409);
  });

  await context.test('the same key may be used independently by different stores', async () => {
    const key = randomUUID();
    const first = await request('/sales', sale({ idempotencyKey: key, items: undefined }));
    const second = await request('/sales', sale({ idempotencyKey: key, items: undefined }), tokenB);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.body.id, second.body.id);
  });

  await context.test('supports anonymous amount-only sales without a loyalty event', async () => {
    const eventCount = state.events.length;
    const result = await request('/sales', sale({ items: undefined }));
    assert.equal(result.status, 201);
    assert.equal(result.body.customerId, null);
    assert.deepEqual(result.body.items, []);
    assert.equal(state.events.length, eventCount);
  });

  await context.test('all valid purchases produce events even within the same mission cooldown', async () => {
    const before = state.events.length;
    for (let count = 0; count < 2; count++) {
      assert.equal((await request('/sales', sale({ customerId: customerA.id }))).status, 201);
    }
    assert.equal(state.events.length, before + 2);
  });

  await context.test('rejects foreign customers/products without writing a sale', async () => {
    const count = state.sales.length;
    assert.equal((await request('/sales', sale({ customerId: customerB.id }))).status, 404);
    assert.equal((await request('/sales', sale({
      items: [{ productId: productB.id, quantity: 2, unitPrice: 9.95 }],
    }))).status, 404);
    assert.equal(state.sales.length, count);
  });

  await context.test('rejects invalid money, quantities, totals, associations and server-owned fields', async () => {
    const invalid = [
      { amount: -1 }, { amount: 0 }, { amount: 1.001 }, { amount: '19.90' },
      { amount: 10_000_000_000 }, { idempotencyKey: undefined },
      { items: [] }, { items: [{ productId: productA.id, quantity: 0, unitPrice: 19.9 }] },
      { items: [{ productId: productA.id, quantity: 0.5, unitPrice: 39.8 }] },
      { items: [{ productId: productA.id, quantity: 1, unitPrice: 19.901 }] },
      { items: [{ productId: productA.id, quantity: 1, unitPrice: 10 }] },
      { items: [{ productId: productA.id, quantity: 1, unitPrice: 9.95 },
        { productId: productA.id, quantity: 1, unitPrice: 9.95 }] },
      { customerId: customerA.id, customerPhone: customerA.phone },
      { tenantId: tenantB }, { createdById: staffB }, { type: 'REFUND' }, { points: 100 },
    ];
    const count = state.sales.length;
    for (const changes of invalid) {
      assert.equal((await request('/sales', sale(changes))).status, 400, JSON.stringify(changes));
    }
    assert.equal(state.sales.length, count);
  });

  await context.test('outbox failure rolls back the sale', async () => {
    const count = state.sales.length;
    const events = state.events.length;
    state.failEvent = true;
    try {
      assert.equal((await request('/sales', sale({ customerId: customerA.id }))).status, 500);
      assert.equal(state.sales.length, count);
      assert.equal(state.events.length, events);
    } finally {
      state.failEvent = false;
    }
  });

  await context.test('missing tenant context fails closed in internal customer lookups', async () => {
    const customers = module.get(CustomersService);
    await assert.rejects(customers.findByPhone(undefined as any, newCustomer.phone), { status: 401 });
    await assert.rejects(customers.findById('', customerA.id), { status: 401 });
  });

  await context.test('rejects expired, invalid, moved or deleted staff identities', async () => {
    const expired = await jwt.signAsync({ sub: staffA, tenantId: tenantA, role: 'B2B', userRole: 'STAFF' }, { expiresIn: -1 });
    const invalid = await jwt.signAsync({ sub: staffA, tenantId: tenantA, role: 'B2B', userRole: 'STAFF' }, { secret: 'wrong' });
    const moved = await jwt.signAsync({ sub: staffA, tenantId: tenantB, role: 'B2B', userRole: 'STAFF' });
    for (const token of [expired, invalid, moved]) {
      assert.equal((await request('/sales', sale(), token)).status, 401);
    }
    state.users = state.users.filter((row) => row.id !== staffA);
    assert.equal((await request('/sales', sale())).status, 401);
  });
});
