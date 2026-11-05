import { randomUUID } from 'node:crypto';
import { Prisma, Role, Tenant, User } from '@prisma/client';

function uniqueError(field: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002', clientVersion: 'test', meta: { target: [field] },
  });
}

function publicUser(user: User) {
  const { passwordHash: _hash, ...result } = user;
  return result;
}

export function authPrismaFixture() {
  const state = { tenants: [] as Tenant[], users: [] as User[], failUserCreation: false };

  function createUser(tenantId: string, data: Prisma.UserCreateWithoutTenantInput | Prisma.UserUncheckedCreateWithoutTenantInput) {
    if (state.failUserCreation) throw new Error('Injected user creation failure');
    if (state.users.some((row) => row.email === data.email)) throw uniqueError('email');
    const user: User = {
      id: data.id ?? randomUUID(), tenantId, name: data.name, email: data.email,
      passwordHash: data.passwordHash, role: data.role ?? Role.OWNER,
      createdAt: data.createdAt == null ? new Date() : new Date(data.createdAt),
    };
    state.users.push(user);
    return user;
  }

  const models = {
    tenant: {
      create: async ({ data }: Prisma.TenantCreateArgs) => {
        if (state.tenants.some((row) => row.slug === data.slug)) throw uniqueError('slug');
        const tenant: Tenant = {
          id: data.id ?? randomUUID(), name: data.name, slug: data.slug, plan: data.plan ?? 'PRO',
          whatsappNumber: data.whatsappNumber ?? null, createdAt: new Date(), updatedAt: new Date(),
        };
        state.tenants.push(tenant);
        const nested = data.users?.create;
        if (Array.isArray(nested)) throw new Error('Unexpected bulk user creation');
        const owner = nested ? createUser(tenant.id, nested) : undefined;
        return { ...tenant, users: owner ? [publicUser(owner)] : [] };
      },
      findUnique: async ({ where }: Prisma.TenantFindUniqueArgs) =>
        state.tenants.find((row) => row.id === where.id) ?? null,
    },
    user: {
      create: async ({ data }: Prisma.UserCreateArgs) => {
        if (!data.tenantId || !state.tenants.some((row) => row.id === data.tenantId)) {
          throw new Error('Missing tenant association');
        }
        return publicUser(createUser(data.tenantId, data));
      },
      findUnique: async ({ where }: Prisma.UserFindUniqueArgs) => {
        const user = state.users.find((row) => row.email === where.email);
        if (!user) return null;
        return { ...user, tenant: state.tenants.find((row) => row.id === user.tenantId) };
      },
    },
  };
  const database = {
    ...models,
    $transaction: async <Result>(operation: (client: typeof models) => Promise<Result>): Promise<Result> => {
      const snapshot = { tenants: [...state.tenants], users: [...state.users] };
      try {
        return await operation(models);
      } catch (error: unknown) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  };
  return { state, database };
}
