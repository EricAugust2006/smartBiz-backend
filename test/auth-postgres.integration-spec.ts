import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import { getRounds } from 'bcryptjs';
import { PrismaService } from '@database/prisma.service';
import { AuthModule } from '@modules/auth/auth.module';
import { AuthService } from '@modules/auth/auth.service';

test('PostgreSQL B2B registration atomicity, hashing and concurrent uniqueness', {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL integration tests.',
}, async (context) => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  const ids: string[] = [];
  const config = { get: (key: string) => key === 'JWT_SECRET' ? 'auth-postgres-test-secret' : undefined };
  const module = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
  }).overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(ConfigService).useValue(config).compile();
  const auth = module.get(AuthService);
  const jwt = module.get(JwtService);
  context.after(async () => {
    try {
      await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await module.close();
      await prisma.$disconnect();
    }
  });
  const unique = randomUUID();
  const dto = { tenantName: `Auth test ${unique}`, userName: 'Owner', email: `${unique}@example.test`, password: 'senha-segura-123' };
  const result = await auth.register(dto);
  ids.push(result.tenant.id);

  await context.test('creates a linked OWNER, hashes with cost 12 and returns no credential fields', async () => {
    assert.equal(result.user.role, Role.OWNER);
    assert.equal(result.user.tenantId, result.tenant.id);
    assert.equal('passwordHash' in result.user, false);
    const user = await prisma.user.findFirstOrThrow({ where: { tenantId: result.tenant.id, id: result.user.id } });
    assert.equal(getRounds(user.passwordHash), 12);
    assert.notEqual(user.passwordHash, dto.password);
    const login = await auth.login(dto.email, dto.password);
    const claims = await jwt.verifyAsync<Record<string, unknown>>(login.access_token);
    assert.equal(claims.sub, result.user.id);
    assert.equal(claims.tenantId, result.tenant.id);
    assert.equal(claims.role, 'B2B');
    assert.equal(claims.userRole, 'OWNER');
    assert.ok(typeof claims.exp === 'number' && typeof claims.iat === 'number');
    assert.equal(claims.exp - claims.iat, 86400);
  });

  await context.test('duplicate email and hash rejection leave no partial tenants', async () => {
    const duplicateName = `${dto.tenantName}-duplicate`;
    await assert.rejects(auth.register({ ...dto, tenantName: duplicateName }), { status: 409 });
    assert.equal(await prisma.tenant.count({ where: { name: duplicateName } }), 0);
    const invalidName = `${dto.tenantName}-hash-failure`;
    await assert.rejects(auth.register({ ...dto, tenantName: invalidName, password: 'é'.repeat(40) }), { status: 400 });
    assert.equal(await prisma.tenant.count({ where: { name: invalidName } }), 0);
  });

  await context.test('an actual user-write failure rolls back the earlier tenant insert', async () => {
    const failingClient = prisma.$extends({
      query: { user: { async create() { throw new Error('Injected user creation failure'); } } },
    });
    const failingModule = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(PrismaService).useValue(failingClient)
      .overrideProvider(ConfigService).useValue(config).compile();
    const failedName = `${dto.tenantName}-write-failure`;
    try {
      await assert.rejects(failingModule.get(AuthService).register({
        ...dto, tenantName: failedName, email: `failure-${unique}@example.test`,
      }), /Injected user creation failure/);
    } finally {
      await failingModule.close();
    }
    assert.equal(await prisma.tenant.count({ where: { name: failedName } }), 0);
  });

  await context.test('simultaneous registration of the same email commits one owner and one tenant', async () => {
    const email = `concurrent-${unique}@example.test`;
    const registrations = await Promise.allSettled([
      auth.register({ ...dto, email, tenantName: `${dto.tenantName}-first` }),
      auth.register({ ...dto, email, tenantName: `${dto.tenantName}-second` }),
    ]);
    let successes = 0;
    for (const registration of registrations) {
      if (registration.status === 'fulfilled') {
        ids.push(registration.value.tenant.id);
        successes++;
        continue;
      }
      const error: unknown = registration.reason;
      assert.ok(error instanceof ConflictException);
    }
    assert.equal(successes, 1);
  });
});
