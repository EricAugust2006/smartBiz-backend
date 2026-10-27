import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { AddressInfo } from 'node:net';
import { PrismaService } from '../src/database/prisma.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { JwtStrategy } from '../src/modules/auth/jwt.strategy';
import { getJwtModuleOptions } from '../src/modules/auth/jwt.config';
import { TenantsModule } from '../src/modules/tenants/tenants.module';

interface MemoryTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  whatsappNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MemoryUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'OWNER' | 'STAFF' | 'ADMIN';
  createdAt: Date;
}

function uniqueConstraintError(target: string) {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: 'test', meta: { target: [target] } },
  );
}

function createMemoryPrisma() {
  const tenants: MemoryTenant[] = [];
  const users: MemoryUser[] = [];
  let nextId = 1;

  const transaction = {
    tenant: {
      create: async ({ data }: any) => {
        if (tenants.some((tenant) => tenant.slug === data.slug)) {
          throw uniqueConstraintError('slug');
        }
        if (users.some((user) => user.email === data.users.create.email)) {
          throw uniqueConstraintError('email');
        }

        const now = new Date();
        const tenant: MemoryTenant = {
          id: `tenant-${nextId++}`,
          name: data.name,
          slug: data.slug,
          plan: 'PRO',
          whatsappNumber: data.whatsappNumber ?? null,
          createdAt: now,
          updatedAt: now,
        };
        const owner: MemoryUser = {
          id: `user-${nextId++}`,
          tenantId: tenant.id,
          name: data.users.create.name,
          email: data.users.create.email,
          passwordHash: data.users.create.passwordHash,
          role: data.users.create.role,
          createdAt: now,
        };

        tenants.push(tenant);
        users.push(owner);

        return {
          ...tenant,
          users: [{
            id: owner.id,
            name: owner.name,
            email: owner.email,
            role: owner.role,
            createdAt: owner.createdAt,
          }],
        };
      },
    },
  };

  return {
    tenants,
    users,
    $transaction: (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    tenant: {
      findUnique: async ({ where }: any) =>
        tenants.find((tenant) => tenant.id === where.id) ?? null,
    },
    user: {
      findUnique: async ({ where }: any) => {
        const user = users.find((candidate) => candidate.email === where.email);
        if (!user) {
          return null;
        }
        return {
          ...user,
          tenant: tenants.find((tenant) => tenant.id === user.tenantId),
        };
      },
    },
  };
}

async function verifyJwtConfiguration() {
  const emptyConfig = {
    get: (_key: string) => undefined,
  } as Pick<ConfigService, 'get'>;
  assert.throws(
    () => getJwtModuleOptions(emptyConfig),
    /JWT_SECRET must be configured/,
  );

  const compileAuthModule = async (config: Record<string, string>) => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => config],
        }),
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    module.get(JwtService);
    module.get(JwtStrategy);
    await module.init();
    return module;
  };

  const moduleWithSecret = await compileAuthModule(
    { JWT_SECRET: 'test-secret', JWT_EXPIRATION: '1h' },
  );
  await moduleWithSecret.close();
}

test('company registration, login and protected current-tenant lookup', async (context) => {
  await verifyJwtConfiguration();

  const prisma = createMemoryPrisma();
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => ({
          JWT_SECRET: 'test-secret',
          JWT_EXPIRATION: '1h',
        })],
      }),
      AuthModule,
      TenantsModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app: INestApplication = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  await app.listen(0);
  context.after(async () => {
    await app.close();
  });

  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const registration = {
    name: 'Cafe Central',
    slug: 'cafe-central',
    ownerName: 'Ana Silva',
    email: 'ana@example.com',
    password: 'senha-segura-123',
  };

  const invalidRegistration = await fetch(`${baseUrl}/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...registration, role: 'ADMIN' }),
  });
  assert.equal(invalidRegistration.status, 400);

  const registrationResponse = await fetch(`${baseUrl}/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registration),
  });
  assert.equal(registrationResponse.status, 201);
  const registered = await registrationResponse.json();
  assert.equal(registered.owner.role, 'OWNER');
  assert.equal('password' in registered.owner, false);
  assert.equal('passwordHash' in registered.owner, false);
  assert.notEqual(prisma.users[0].passwordHash, registration.password);
  assert.equal(prisma.tenants.length, 1);
  assert.equal(prisma.users.length, 1);

  const duplicateResponse = await fetch(`${baseUrl}/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(registration),
  });
  assert.equal(duplicateResponse.status, 409);
  assert.equal(prisma.tenants.length, 1);
  assert.equal(prisma.users.length, 1);

  const duplicateEmailResponse = await fetch(`${baseUrl}/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...registration,
      name: 'Cafe Secundario',
      slug: 'cafe-secundario',
    }),
  });
  assert.equal(duplicateEmailResponse.status, 409);
  assert.equal(prisma.tenants.length, 1);
  assert.equal(prisma.users.length, 1);

  const invalidEmailLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.com', password: registration.password }),
  });
  const invalidPasswordLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: registration.email, password: 'senha-errada-123' }),
  });
  assert.equal(invalidEmailLogin.status, 401);
  assert.equal(invalidPasswordLogin.status, 401);

  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: registration.email,
      password: registration.password,
    }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal('passwordHash' in login.user, false);
  const jwt = module.get(JwtService, { strict: false });
  const payload = await jwt.verifyAsync(login.access_token);
  assert.equal(payload.sub, prisma.users[0].id);
  assert.equal(payload.tenantId, prisma.tenants[0].id);
  assert.equal(payload.role, 'OWNER');

  const unauthenticatedResponse = await fetch(`${baseUrl}/tenants/me`);
  assert.equal(unauthenticatedResponse.status, 401);

  const invalidToken = await jwt.signAsync(
    {
      sub: prisma.users[0].id,
      tenantId: prisma.tenants[0].id,
      role: 'OWNER',
    },
    { secret: 'different-secret' },
  );
  const invalidTokenResponse = await fetch(`${baseUrl}/tenants/me`, {
    headers: { authorization: `Bearer ${invalidToken}` },
  });
  assert.equal(invalidTokenResponse.status, 401);

  const expiredToken = await jwt.signAsync(
    {
      sub: prisma.users[0].id,
      tenantId: prisma.tenants[0].id,
      role: 'OWNER',
    },
    { expiresIn: -1 },
  );
  const expiredTokenResponse = await fetch(`${baseUrl}/tenants/me`, {
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(expiredTokenResponse.status, 401);

  const tenantResponse = await fetch(`${baseUrl}/tenants/me`, {
    headers: { authorization: `Bearer ${login.access_token}` },
  });
  assert.equal(tenantResponse.status, 200);
  const tenant = await tenantResponse.json();
  assert.equal(tenant.id, prisma.tenants[0].id);
  assert.equal('passwordHash' in tenant, false);

  const overriddenTenantResponse = await fetch(
    `${baseUrl}/tenants/me?tenantId=another-company`,
    { headers: { authorization: `Bearer ${login.access_token}` } },
  );
  assert.equal(overriddenTenantResponse.status, 200);
  const overriddenTenant = await overriddenTenantResponse.json();
  assert.equal(overriddenTenant.id, prisma.tenants[0].id);

  const strategy = module.get(JwtStrategy);
  assert.throws(
    () => strategy.validate({ sub: 'user', tenantId: 'tenant', role: 'INVALID' }),
    { status: 401 },
  );

  prisma.tenants.length = 0;
  const deletedTenantResponse = await fetch(`${baseUrl}/tenants/me`, {
    headers: { authorization: `Bearer ${login.access_token}` },
  });
  assert.equal(deletedTenantResponse.status, 404);
});
