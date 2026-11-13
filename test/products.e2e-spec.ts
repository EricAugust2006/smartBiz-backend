import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, Product } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { ProductsModule } from '@modules/products/products.module';
import { ProductsService } from '@modules/products/products.service';

interface HttpResult { status: number; body: unknown }

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function memoryProducts() {
  const rows: Product[] = [];
  function scopedTenant(where: Prisma.ProductWhereInput | Prisma.ProductWhereUniqueInput | undefined): string {
    if (typeof where?.tenantId !== 'string' || !where.tenantId) throw new Error('Missing tenant scope');
    return where.tenantId;
  }
  function selected(row: Product) {
    return {
      id: row.id, tenantId: row.tenantId, name: row.name, price: row.price,
      category: row.category, isActive: row.isActive, createdAt: row.createdAt,
    };
  }
  const product = {
    create: async ({ data }: Prisma.ProductCreateArgs) => {
      if (!data.tenantId) throw new Error('Missing tenant on create');
      const row: Product = {
        id: randomUUID(), tenantId: data.tenantId, name: data.name, category: data.category,
        price: new Prisma.Decimal(data.price.toString()), isActive: data.isActive ?? true,
        quantity: data.quantity ?? 0, minQuantity: data.minQuantity ?? 5,
        costPrice: data.costPrice ?? 0,
        expirationDate: data.expirationDate == null ? null : new Date(data.expirationDate),
        createdAt: new Date(Date.now() + rows.length), updatedAt: new Date(),
      };
      rows.push(row);
      return selected(row);
    },
    findMany: async ({ where }: Prisma.ProductFindManyArgs) => {
      const tenantId = scopedTenant(where);
      const nameFilter = typeof where?.name === 'object' && where.name !== null ? where.name : undefined;
      const categoryFilter = typeof where?.category === 'object' && where.category !== null ? where.category : undefined;
      const name = nameFilter?.contains;
      const category = categoryFilter?.equals;
      return rows.filter((row) => row.tenantId === tenantId
        && (typeof name !== 'string' || row.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
        && (typeof category !== 'string' || row.category.toLocaleLowerCase() === category.toLocaleLowerCase()))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .map(selected);
    },
    update: async ({ where, data }: Prisma.ProductUpdateArgs) => {
      const tenantId = scopedTenant(where);
      const row = rows.find((entry) => entry.tenantId === tenantId && entry.id === where.id);
      if (!row) throw new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025', clientVersion: 'test',
      });
      if (typeof data.name === 'string') row.name = data.name;
      if (typeof data.category === 'string') row.category = data.category;
      if (data.price !== undefined) row.price = new Prisma.Decimal(data.price.toString());
      if (typeof data.isActive === 'boolean') row.isActive = data.isActive;
      row.updatedAt = new Date();
      return selected(row);
    },
  };
  return { rows, database: { product } };
}

test('products HTTP API enforces tenant isolation, filters, decimal output, and validation', async (context) => {
  const { rows, database } = memoryProducts();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({
      isGlobal: true, ignoreEnvFile: true,
      load: [() => ({ JWT_SECRET: 'products-test-secret', JWT_EXPIRATION: '1h' })],
    }),
    ProductsModule,
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
    return { status: response.status, body: await response.json() as unknown };
  };

  await context.test('all product routes require a valid JWT', async () => {
    assert.equal((await request('POST', '/products', { name: 'A', price: 1, category: 'C' }, null)).status, 401);
    assert.equal((await request('GET', '/products', undefined, null)).status, 401);
    assert.equal((await request('PATCH', `/products/${randomUUID()}`, { price: 2 }, null)).status, 401);
  });

  let productA = '';
  let productB = '';
  await context.test('creates products with trimmed text and a fixed decimal string price', async () => {
    const response = await request('POST', '/products', {
      name: '  Café especial  ', category: '  Bebida  ', price: 12.5,
    });
    assert.equal(response.status, 201);
    const body = record(response.body);
    productA = body.id as string;
    assert.equal(body.tenantId, tenantA);
    assert.equal(body.name, 'Café especial');
    assert.equal(body.category, 'Bebida');
    assert.equal(body.price, '12.50');
    assert.equal(body.isActive, true);
    assert.ok(typeof body.createdAt === 'string');
    assert.equal('quantity' in body, false);
    const foreign = await request('POST', '/products', { name: 'Café', category: 'Bebida', price: 1 }, tokenB);
    assert.equal(foreign.status, 201);
    productB = record(foreign.body).id as string;
  });

  await context.test('rejects invalid payloads and client-controlled tenant or state fields', async () => {
    const invalid: Record<string, unknown>[] = [
      { name: undefined }, { name: '  ' }, { name: 'x'.repeat(121) },
      { price: undefined }, { price: null }, { price: '12.00' }, { price: -1 }, { price: 1.001 },
      { price: 100_000_000 }, { category: undefined }, { category: '  ' },
      { tenantId: tenantB }, { isActive: false }, { quantity: 5 },
    ];
    const before = rows.length;
    for (const changes of invalid) {
      const body = { name: 'Produto', category: 'Geral', price: 10, ...changes };
      assert.equal((await request('POST', '/products', body)).status, 400, JSON.stringify(changes));
    }
    assert.equal(rows.length, before);
  });

  await context.test('lists only the current tenant and filters name search/category', async () => {
    const result = await request('GET', '/products?name=Caf%C3%A9&category=Bebida');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body));
    assert.equal(result.body.length, 1);
    assert.equal(record(result.body[0]).id, productA);
    const noMatch = await request('GET', '/products?category=Outra');
    assert.deepEqual(noMatch.body, []);
  });

  await context.test('updates product fields and deactivates products', async () => {
    const response = await request('PATCH', `/products/${productA}`, { name: '  Café premium ', price: 19.9 });
    assert.equal(response.status, 200);
    assert.equal(record(response.body).name, 'Café premium');
    assert.equal(record(response.body).price, '19.90');
    assert.equal(record((await request('PATCH', `/products/${productA}`, { isActive: false })).body).isActive, false);
    for (const body of [{}, { price: null }, { category: '  ' }, { isActive: 'false' }, { tenantId: tenantB }]) {
      assert.equal((await request('PATCH', `/products/${productA}`, body)).status, 400);
    }
    assert.equal((await request('PATCH', '/products/not-a-uuid', { price: 1 })).status, 400);
  });

  await context.test('cross-tenant updates return the same 404 as missing products', async () => {
    const foreign = await request('PATCH', `/products/${productB}`, { price: 99 });
    const missing = await request('PATCH', `/products/${randomUUID()}`, { price: 99 });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.equal(rows.find((row) => row.id === productB)?.price.toFixed(2), '1.00');
  });

  const service = module.get(ProductsService);
  await assert.rejects(service.findAll('', {}), { status: 401 });
  await assert.rejects(service.create('', { name: 'X', category: 'X', price: 1 }), { status: 401 });
  await assert.rejects(service.update('', productA, { price: 2 }), { status: 401 });
});

test('PostgreSQL product decimal persistence and tenant-scoped updates', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const tenants = [randomUUID(), randomUUID()];
  const module = await Test.createTestingModule({
    providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  const service = module.get(ProductsService);
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    } finally {
      await module.close();
      await prisma.$disconnect();
    }
  });
  for (const id of tenants) await prisma.tenant.create({ data: { id, name: 'Products test', slug: `products-${id}` } });
  const [tenantId, foreignTenantId] = tenants;
  const own = await service.create(tenantId, { name: 'Coffee', category: 'Drink', price: 14.3 });
  const foreign = await service.create(foreignTenantId, { name: 'Tea', category: 'Drink', price: 8.25 });
  assert.equal(own.price, '14.30');
  assert.deepEqual((await service.findAll(tenantId, {})).map((product) => product.id), [own.id]);
  await assert.rejects(service.update(tenantId, foreign.id, { price: 99 }), { status: 404 });
  assert.equal((await service.update(tenantId, own.id, { isActive: false })).isActive, false);
  assert.equal((await prisma.product.findFirstOrThrow({ where: { tenantId, id: own.id } })).price.toFixed(2), '14.30');
});
