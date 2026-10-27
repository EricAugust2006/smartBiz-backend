"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = require("node:assert/strict");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const testing_1 = require("@nestjs/testing");
const jwt_1 = require("@nestjs/jwt");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../src/database/prisma.service");
const auth_module_1 = require("../src/modules/auth/auth.module");
const jwt_strategy_1 = require("../src/modules/auth/jwt.strategy");
const tenants_module_1 = require("../src/modules/tenants/tenants.module");
function uniqueConstraintError(target) {
    return new client_1.Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test', meta: { target: [target] } });
}
function createMemoryPrisma() {
    const tenants = [];
    const users = [];
    let nextId = 1;
    const transaction = {
        tenant: {
            create: async ({ data }) => {
                if (tenants.some((tenant) => tenant.slug === data.slug)) {
                    throw uniqueConstraintError('slug');
                }
                if (users.some((user) => user.email === data.users.create.email)) {
                    throw uniqueConstraintError('email');
                }
                const now = new Date();
                const tenant = {
                    id: `tenant-${nextId++}`,
                    name: data.name,
                    slug: data.slug,
                    plan: 'PRO',
                    whatsappNumber: data.whatsappNumber ?? null,
                    createdAt: now,
                    updatedAt: now,
                };
                const owner = {
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
        $transaction: (callback) => callback(transaction),
        tenant: {
            findUnique: async ({ where }) => tenants.find((tenant) => tenant.id === where.id) ?? null,
        },
        user: {
            findUnique: async ({ where }) => {
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
(0, node_test_1.test)('JWT configuration fails without a secret and initializes with one', async () => {
    const compileAuthModule = (config) => testing_1.Test.createTestingModule({ imports: [auth_module_1.AuthModule] })
        .overrideProvider(config_1.ConfigService)
        .useValue(config)
        .overrideProvider(prisma_service_1.PrismaService)
        .useValue({})
        .compile();
    const moduleWithSecret = await compileAuthModule(new config_1.ConfigService({ JWT_SECRET: 'test-secret', JWT_EXPIRATION: '1h' }));
    await moduleWithSecret.close();
    await strict_1.default.rejects(compileAuthModule(new config_1.ConfigService({})), /JWT_SECRET must be configured/);
});
(0, node_test_1.test)('company registration, login and protected current-tenant lookup', async (context) => {
    const prisma = createMemoryPrisma();
    const module = await testing_1.Test.createTestingModule({
        imports: [auth_module_1.AuthModule, tenants_module_1.TenantsModule],
    })
        .overrideProvider(config_1.ConfigService)
        .useValue(new config_1.ConfigService({
        JWT_SECRET: 'test-secret',
        JWT_EXPIRATION: '1h',
    }))
        .overrideProvider(prisma_service_1.PrismaService)
        .useValue(prisma)
        .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    await app.listen(0);
    context.after(async () => {
        await app.close();
    });
    const address = app.getHttpServer().address();
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
    strict_1.default.equal(invalidRegistration.status, 400);
    const registrationResponse = await fetch(`${baseUrl}/tenants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registration),
    });
    strict_1.default.equal(registrationResponse.status, 201);
    const registered = await registrationResponse.json();
    strict_1.default.equal(registered.owner.role, 'OWNER');
    strict_1.default.equal('password' in registered.owner, false);
    strict_1.default.equal('passwordHash' in registered.owner, false);
    strict_1.default.notEqual(prisma.users[0].passwordHash, registration.password);
    strict_1.default.equal(prisma.tenants.length, 1);
    strict_1.default.equal(prisma.users.length, 1);
    const duplicateResponse = await fetch(`${baseUrl}/tenants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(registration),
    });
    strict_1.default.equal(duplicateResponse.status, 409);
    strict_1.default.equal(prisma.tenants.length, 1);
    strict_1.default.equal(prisma.users.length, 1);
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
    strict_1.default.equal(invalidEmailLogin.status, 401);
    strict_1.default.equal(invalidPasswordLogin.status, 401);
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            email: registration.email,
            password: registration.password,
        }),
    });
    strict_1.default.equal(loginResponse.status, 200);
    const login = await loginResponse.json();
    strict_1.default.equal('passwordHash' in login.user, false);
    const jwt = module.get(jwt_1.JwtService, { strict: false });
    const payload = await jwt.verifyAsync(login.access_token);
    strict_1.default.equal(payload.sub, prisma.users[0].id);
    strict_1.default.equal(payload.tenantId, prisma.tenants[0].id);
    strict_1.default.equal(payload.role, 'OWNER');
    const unauthenticatedResponse = await fetch(`${baseUrl}/tenants/me`);
    strict_1.default.equal(unauthenticatedResponse.status, 401);
    const tenantResponse = await fetch(`${baseUrl}/tenants/me`, {
        headers: { authorization: `Bearer ${login.access_token}` },
    });
    strict_1.default.equal(tenantResponse.status, 200);
    const tenant = await tenantResponse.json();
    strict_1.default.equal(tenant.id, prisma.tenants[0].id);
    strict_1.default.equal('passwordHash' in tenant, false);
    const strategy = module.get(jwt_strategy_1.JwtStrategy);
    strict_1.default.throws(() => strategy.validate({ sub: 'user', tenantId: 'tenant', role: 'INVALID' }), { status: 401 });
    prisma.tenants.length = 0;
    const deletedTenantResponse = await fetch(`${baseUrl}/tenants/me`, {
        headers: { authorization: `Bearer ${login.access_token}` },
    });
    strict_1.default.equal(deletedTenantResponse.status, 404);
});
//# sourceMappingURL=auth-tenant.e2e-spec.js.map