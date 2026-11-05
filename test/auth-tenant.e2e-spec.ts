import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Controller, Get, UseGuards, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { getRounds } from 'bcryptjs';
import { PrismaService } from '@database/prisma.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthenticatedUser, JwtStrategy } from '@modules/auth/jwt.strategy';
import { B2B_JWT_TTL_SECONDS, getJwtModuleOptions } from '@modules/auth/jwt.config';
import { TenantsModule } from '@modules/tenants/tenants.module';
import { authPrismaFixture } from './support/auth-prisma.fixture';

const SECRET = 'auth-b2b-test-secret';

@Controller('auth-context')
@UseGuards(JwtAuthGuard)
class AuthContextController {
  @Get()
  get(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return { ...user, tenantId };
  }
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function field(value: unknown, name: string): string {
  const result = record(value)[name];
  assert.ok(typeof result === 'string');
  return result;
}

function signClaims(claims: Record<string, unknown>, secret = SECRET, algorithm = 'HS256'): string {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })).toString('base64url');
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${createHmac(algorithm === 'HS512' ? 'sha512' : 'sha256', secret).update(unsigned).digest('base64url')}`;
}

test('B2B signup, login, claims and protected tenant integration', async (context) => {
  assert.throws(() => getJwtModuleOptions({ get: () => undefined }), /JWT_SECRET must be configured/);
  assert.equal(B2B_JWT_TTL_SECONDS, 86400);
  const { state, database } = authPrismaFixture();
  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, TenantsModule],
    controllers: [AuthContextController],
  }).overrideProvider(PrismaService).useValue(database)
    .overrideProvider(ConfigService).useValue({
      get: (key: string): string | undefined => {
        const config: Record<string, string> = { JWT_SECRET: SECRET, JWT_EXPIRATION: '7d' };
        return config[key];
      },
    }).compile();
  const app = module.createNestApplication();
  app.useLogger(false);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors();
  await app.listen(0);
  context.after(() => app.close());
  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jwt = module.get(JwtService);
  const request = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result: unknown = await response.json();
    return { status: response.status, body: result };
  };
  const registration = { tenantName: 'Café Central', userName: 'Ana Silva', email: 'ana@example.com', password: 'senha-segura-123' };
  let userId = '';
  let tenantId = '';
  let accessToken = '';

  await context.test('browser preflight and public auth validation work from the frontend origin', async () => {
    for (const path of ['/auth/register', '/auth/login']) {
      const preflight = await fetch(`${baseUrl}${path}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3001',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
      assert.ok(preflight.headers.get('access-control-allow-methods')?.includes('POST'));
      const invalid = await fetch(`${baseUrl}${path}`, {
        method: 'POST', headers: { Origin: 'http://localhost:3001', 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.headers.get('access-control-allow-origin'), '*');
    }
    assert.equal(state.tenants.length, 0);
  });

  await context.test('public registration creates tenant and OWNER with bcrypt cost 12', async () => {
    const result = await request('/auth/register', {
      ...registration, tenantName: '  Café Central  ', userName: '  Ana Silva  ', email: ' ana@example.com ',
    });
    assert.equal(result.status, 201);
    const body = record(result.body);
    userId = field(body.user, 'id');
    tenantId = field(body.tenant, 'id');
    assert.equal(record(body.user).role, 'OWNER');
    assert.equal(record(body.user).tenantId, tenantId);
    assert.equal(record(body.tenant).name, 'Café Central');
    assert.equal(record(body.user).name, 'Ana Silva');
    assert.equal(record(body.user).email, registration.email);
    assert.equal('passwordHash' in record(body.user), false);
    assert.equal('password' in record(body.user), false);
    assert.match(field(body.tenant, 'slug'), /^cafe-central-[a-f0-9-]+$/);
    assert.equal(state.tenants.length, 1);
    assert.equal(state.users.length, 1);
    assert.equal(getRounds(state.users[0].passwordHash), 12);
    assert.notEqual(state.users[0].passwordHash, registration.password);
  });

  await context.test('duplicate emails roll back the newly created tenant', async () => {
    const result = await request('/auth/register', { ...registration, tenantName: 'Outra loja' });
    assert.equal(result.status, 409);
    assert.equal(state.tenants.length, 1);
    assert.equal(state.users.length, 1);
  });

  await context.test('hash failures and user write failures roll back tenant creation', async () => {
    const tooManyBytes = await request('/auth/register', { ...registration, email: 'bytes@example.com', password: 'é'.repeat(40) });
    assert.equal(tooManyBytes.status, 400);
    assert.equal(state.tenants.length, 1);
    state.failUserCreation = true;
    try {
      assert.equal((await request('/auth/register', { ...registration, email: 'failure@example.com' })).status, 500);
    } finally {
      state.failUserCreation = false;
    }
    assert.equal(state.tenants.length, 1);
    assert.equal(state.users.length, 1);
  });

  await context.test('registration validates all fields and rejects caller-controlled roles or tenant IDs', async () => {
    const invalid: Record<string, unknown>[] = [
      { tenantName: undefined }, { tenantName: '  ' }, { tenantName: 'x'.repeat(121) },
      { userName: undefined }, { userName: '  ' }, { userName: 'x'.repeat(121) },
      { email: 'invalid' }, { password: 'short' }, { password: null },
      { tenantId: randomUUID() }, { role: 'ADMIN' }, { userRole: 'ADMIN' },
      { plan: 'ENTERPRISE' }, { passwordHash: 'injected' }, { slug: 'custom-slug' },
    ];
    for (const changes of invalid) {
      assert.equal((await request('/auth/register', { ...registration, ...changes })).status, 400);
    }
    assert.equal(state.tenants.length, 1);
  });

  await context.test('same store names generate different slugs and legacy signup still works', async () => {
    const second = await request('/auth/register', { ...registration, email: 'second@example.com' });
    assert.equal(second.status, 201);
    assert.notEqual(field(record(second.body).tenant, 'slug'), state.tenants[0].slug);
    const legacy = { name: 'Loja antiga', slug: 'loja-antiga', ownerName: 'Dono', email: 'legacy@example.com', password: registration.password };
    assert.equal((await request('/tenants', legacy)).status, 201);
    assert.equal((await request('/tenants', legacy)).status, 409);
    assert.equal((await request('/tenants', { ...legacy, slug: 'outro-slug' })).status, 409);
    assert.equal(state.tenants.length, 3);
  });

  await context.test('login rejects incorrect credentials uniformly and never returns a hash', async () => {
    const missing = await request('/auth/login', { email: 'missing@example.com', password: registration.password });
    const wrong = await request('/auth/login', { email: registration.email, password: 'senha-incorreta' });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.body, wrong.body);
    const result = await request('/auth/login', { email: ` ${registration.email} `, password: registration.password });
    assert.equal(result.status, 200);
    const body = record(result.body);
    accessToken = field(body, 'access_token');
    assert.equal('passwordHash' in record(body.user), false);
    assert.equal(record(body.user).role, 'OWNER');
    assert.equal(field(body.tenant, 'id'), tenantId);
    const claims: unknown = await jwt.verifyAsync(accessToken);
    const payload = record(claims);
    assert.equal(payload.sub, userId);
    assert.equal(payload.tenantId, tenantId);
    assert.equal(payload.role, 'B2B');
    assert.equal(payload.userRole, 'OWNER');
    assert.ok(typeof payload.exp === 'number' && typeof payload.iat === 'number');
    assert.equal(payload.exp - payload.iat, 86400);
  });

  await context.test('CurrentTenant and CurrentUser expose the new authenticated B2B context', async () => {
    const current = await request('/tenants/me', undefined, accessToken);
    assert.equal(current.status, 200);
    assert.equal(record(current.body).id, tenantId);
    const contextResult = await request('/auth-context', undefined, accessToken);
    assert.equal(contextResult.status, 200);
    assert.deepEqual(contextResult.body, { userId, tenantId, role: 'B2B', userRole: 'OWNER' });
    const override = await request(`/tenants/me?tenantId=${randomUUID()}`, undefined, accessToken);
    assert.equal(record(override.body).id, tenantId);
  });

  await context.test('login preserves STAFF and ADMIN as userRole while role stays B2B', async () => {
    const user = state.users.find((row) => row.id === userId)!;
    for (const role of [Role.STAFF, Role.ADMIN]) {
      user.role = role;
      const result = await request('/auth/login', { email: registration.email, password: registration.password });
      const signed = field(result.body, 'access_token');
      const claims: unknown = await jwt.verifyAsync(signed);
      assert.equal(record(claims).role, 'B2B');
      assert.equal(record(claims).userRole, role);
      assert.equal(record((await request('/auth-context', undefined, signed)).body).userRole, role);
    }
    user.role = Role.OWNER;
  });

  await context.test('guard rejects B2C, legacy role claims, invalid permissions, expiry and signatures', async () => {
    const valid = { sub: userId, tenantId, role: 'B2B', userRole: 'OWNER' };
    const invalid = [
      signClaims({ ...valid, role: 'B2C' }), signClaims({ ...valid, role: 'OWNER' }),
      signClaims({ ...valid, role: undefined }), signClaims({ ...valid, userRole: undefined }),
      signClaims({ ...valid, userRole: 'B2B' }), signClaims({ ...valid, tenantId: '' }),
      signClaims({ ...valid, sub: '' }), signClaims({ ...valid, exp: undefined }),
      signClaims({ ...valid, exp: 1 }), signClaims(valid, 'wrong-secret'), signClaims(valid, SECRET, 'HS512'),
    ];
    assert.equal((await request('/tenants/me')).status, 401);
    for (const token of invalid) assert.equal((await request('/tenants/me', undefined, token)).status, 401);
    const strategy = module.get(JwtStrategy);
    assert.throws(() => strategy.validate(null), { status: 401 });
  });

  await context.test('a removed tenant never falls back to another store', async () => {
    state.tenants = state.tenants.filter((row) => row.id !== tenantId);
    assert.equal((await request('/tenants/me', undefined, accessToken)).status, 404);
  });
});
