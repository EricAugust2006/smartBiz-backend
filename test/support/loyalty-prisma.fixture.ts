import { randomUUID } from 'node:crypto';
import { CustomerMissionStatus, GoalType, MissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

interface CustomerRow { id: string; tenantId: string; points: number }
interface SaleRow {
  id: string; tenantId: string; customerId: string | null; amount: Prisma.Decimal; type: string; createdAt: Date;
}
interface EventRow {
  id: string; tenantId: string; transactionId: string; type: string; processedAt: Date | null;
  createdAt: Date; attempts: number; nextAttemptAt: Date; lastError: string | null;
}
interface MissionRow {
  id: string; tenantId: string; status: MissionStatus; goalType: GoalType;
  createdAt: Date; expiresAt: Date | null;
}
interface ProgressRow {
  id: string; tenantId: string; customerId: string; missionId: string;
  status: CustomerMissionStatus; visits: number; lastVisitAt: Date | null;
}
interface LedgerRow {
  tenantId: string; customerId: string; transactionId: string; eventId: string;
  points: number; balanceAfter: number; visitCounted: boolean;
}

function inScope(tenantId: string, where: { tenantId?: unknown } | undefined): boolean {
  if (typeof where?.tenantId !== 'string' || !where.tenantId) throw new Error('Unscoped business query');
  return tenantId === where.tenantId;
}

function textMatches(value: string | null, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (typeof filter === 'string' || filter === null) return value === filter;
  if (typeof filter !== 'object') throw new Error('Unsupported text filter');
  if ('lt' in filter && typeof filter.lt === 'string') return value !== null && value < filter.lt;
  if ('gt' in filter && typeof filter.gt === 'string') return value !== null && value > filter.gt;
  throw new Error('Unsupported text filter');
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return new Date(value).getTime();
  throw new Error('Unsupported date');
}

function dateMatches(value: Date | null, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter === null) return value === null;
  if (value === null) return false;
  if (filter instanceof Date || typeof filter === 'string') return value.getTime() === timestamp(filter);
  if (typeof filter !== 'object' || filter === null) throw new Error('Unsupported date filter');
  if ('gt' in filter && !(value.getTime() > timestamp(filter.gt))) return false;
  if ('gte' in filter && !(value.getTime() >= timestamp(filter.gte))) return false;
  if ('lt' in filter && !(value.getTime() < timestamp(filter.lt))) return false;
  if ('lte' in filter && !(value.getTime() <= timestamp(filter.lte))) return false;
  return true;
}

function increment(operation: unknown): number {
  if (typeof operation === 'object' && operation !== null &&
    'increment' in operation && typeof operation.increment === 'number') return operation.increment;
  throw new Error('Unsupported increment');
}

function matchesSale(row: SaleRow, where: Prisma.TransactionWhereInput, ledger: LedgerRow[]): boolean {
  if (!textMatches(row.id, where.id) || !textMatches(row.customerId, where.customerId) ||
    !textMatches(row.type, where.type) || !dateMatches(row.createdAt, where.createdAt)) return false;
  if (where.pointsLedger && 'is' in where.pointsLedger && where.pointsLedger.is) {
    const relation = where.pointsLedger.is;
    if (!ledger.some((entry) => entry.transactionId === row.id &&
      textMatches(entry.tenantId, relation.tenantId) && entry.visitCounted === relation.visitCounted)) return false;
  }
  return !where.OR || where.OR.some((alternative) => matchesSale(row, alternative, ledger));
}

function matchesMission(row: MissionRow, where: Prisma.MissionWhereInput): boolean {
  if (!textMatches(row.status, where.status) || !textMatches(row.goalType, where.goalType) ||
    !dateMatches(row.createdAt, where.createdAt) || !dateMatches(row.expiresAt, where.expiresAt)) return false;
  return !where.OR || where.OR.some((alternative) => matchesMission(row, alternative));
}

export function loyaltyFixture() {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const customerId = randomUUID();
  const now = new Date('2026-11-03T12:00:00.000Z');
  const state = {
    customers: [{ id: customerId, tenantId, points: 0 }] as CustomerRow[],
    sales: [] as SaleRow[], events: [] as EventRow[], missions: [] as MissionRow[],
    progress: [] as ProgressRow[], ledger: [] as LedgerRow[],
    failLedger: false, conflicts: 0, transactionAttempts: 0,
  };

  const models = {
    tenant: {
      findMany: async (args: Prisma.TenantFindManyArgs) =>
        [tenantId, otherTenantId].filter((id) => textMatches(id, args.where?.id))
          .sort().slice(0, args.take ?? 50).map((id) => ({ id })),
    },
    outboxEvent: {
      findFirst: async (args: Prisma.OutboxEventFindFirstArgs) => state.events.find((row) =>
        inScope(row.tenantId, args.where) && textMatches(row.id, args.where?.id) &&
        textMatches(row.type, args.where?.type)) ?? null,
      findMany: async (args: Prisma.OutboxEventFindManyArgs) => state.events.filter((row) =>
        inScope(row.tenantId, args.where) && textMatches(row.type, args.where?.type) &&
        row.processedAt === null && dateMatches(row.nextAttemptAt, args.where?.nextAttemptAt))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, args.take ?? 100),
      updateMany: async (args: Prisma.OutboxEventUpdateManyArgs) => {
        const rows = state.events.filter((row) => inScope(row.tenantId, args.where) &&
          textMatches(row.id, args.where?.id) && textMatches(row.type, args.where?.type) &&
          row.processedAt === null && (args.where?.attempts === undefined || args.where.attempts === row.attempts));
        for (const row of rows) {
          if (args.data.processedAt instanceof Date) row.processedAt = args.data.processedAt;
          if (args.data.attempts !== undefined) row.attempts += increment(args.data.attempts);
          if (args.data.nextAttemptAt instanceof Date) row.nextAttemptAt = args.data.nextAttemptAt;
          if (typeof args.data.lastError === 'string' || args.data.lastError === null) row.lastError = args.data.lastError;
        }
        return { count: rows.length };
      },
    },
    transaction: {
      findFirst: async (args: Prisma.TransactionFindFirstArgs) => state.sales.find((row) =>
        inScope(row.tenantId, args.where) && matchesSale(row, args.where ?? {}, state.ledger)) ?? null,
    },
    customer: {
      updateMany: async (args: Prisma.CustomerUpdateManyArgs) => {
        const rows = state.customers.filter((row) => {
          if (!inScope(row.tenantId, args.where) || !textMatches(row.id, args.where?.id)) return false;
          const condition = args.where?.points;
          return typeof condition !== 'object' || condition.lte === undefined ||
            (typeof condition.lte === 'number' && row.points <= condition.lte);
        });
        for (const row of rows) row.points += increment(args.data.points);
        return { count: rows.length };
      },
      findFirst: async (args: Prisma.CustomerFindFirstArgs) => state.customers.find((row) =>
        inScope(row.tenantId, args.where) && textMatches(row.id, args.where?.id)) ?? null,
    },
    mission: {
      findMany: async (args: Prisma.MissionFindManyArgs) => state.missions.filter((row) =>
        inScope(row.tenantId, args.where) && matchesMission(row, args.where ?? {})),
    },
    customerMission: {
      findFirst: async (args: Prisma.CustomerMissionFindFirstArgs) => state.progress.find((row) =>
        inScope(row.tenantId, args.where) && textMatches(row.customerId, args.where?.customerId) &&
        textMatches(row.missionId, args.where?.missionId)) ?? null,
      create: async (args: Prisma.CustomerMissionCreateArgs) => {
        const data = args.data;
        if (!data.tenantId || !data.customerId || !data.missionId || !(data.lastVisitAt instanceof Date)) {
          throw new Error('Missing progress data');
        }
        const row: ProgressRow = {
          id: randomUUID(), tenantId: data.tenantId, customerId: data.customerId, missionId: data.missionId,
          visits: data.visits ?? 0, lastVisitAt: data.lastVisitAt, status: CustomerMissionStatus.PENDING,
        };
        state.progress.push(row);
        return row;
      },
      updateMany: async (args: Prisma.CustomerMissionUpdateManyArgs) => {
        const rows = state.progress.filter((row) => inScope(row.tenantId, args.where) &&
          textMatches(row.id, args.where?.id) && textMatches(row.status, args.where?.status));
        for (const row of rows) {
          row.visits += increment(args.data.visits);
          if (args.data.lastVisitAt instanceof Date) row.lastVisitAt = args.data.lastVisitAt;
        }
        return { count: rows.length };
      },
    },
    pointsLedger: {
      create: async (args: Prisma.PointsLedgerCreateArgs) => {
        if (state.failLedger) throw new Error('Injected ledger failure');
        const data = args.data;
        if (!data.tenantId || !data.customerId || !data.transactionId || !data.eventId) {
          throw new Error('Missing ledger data');
        }
        if (state.ledger.some((row) => row.tenantId === data.tenantId && row.transactionId === data.transactionId)) {
          throw new Error('Duplicate ledger');
        }
        const row: LedgerRow = {
          tenantId: data.tenantId, customerId: data.customerId, transactionId: data.transactionId,
          eventId: data.eventId, points: data.points, balanceAfter: data.balanceAfter, visitCounted: data.visitCounted,
        };
        state.ledger.push(row);
        return row;
      },
    },
  };
  const client = {
    ...models,
    $transaction: async <Result>(callback: (database: typeof models) => Promise<Result>): Promise<Result> => {
      state.transactionAttempts++;
      if (state.conflicts > 0) {
        state.conflicts--;
        throw new Prisma.PrismaClientKnownRequestError('Retry transaction', { code: 'P2034', clientVersion: 'test' });
      }
      const snapshot = {
        customers: state.customers.map((row) => ({ ...row })), events: state.events.map((row) => ({ ...row })),
        progress: state.progress.map((row) => ({ ...row })), ledger: [...state.ledger],
      };
      try {
        return await callback(models);
      } catch (error: unknown) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  };

  function sale(createdAt = now, amount = '19.90', owner = tenantId, id = randomUUID()) {
    const row: SaleRow = { id, tenantId: owner, customerId, amount: new Prisma.Decimal(amount), type: 'SALE', createdAt };
    state.sales.push(row);
    const event: EventRow = {
      id: randomUUID(), tenantId: owner, transactionId: id, type: 'sale.confirmed',
      processedAt: null, createdAt, attempts: 0, nextAttemptAt: new Date(0), lastError: null,
    };
    state.events.push(event);
    return { sale: row, event };
  }

  function mission(changes: Partial<MissionRow> = {}) {
    const row: MissionRow = {
      id: randomUUID(), tenantId, status: MissionStatus.ACTIVE, goalType: GoalType.VISITS,
      createdAt: new Date(now.getTime() - 7 * 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      ...changes,
    };
    state.missions.push(row);
    return row;
  }

  return { prisma: client as unknown as PrismaService, state, tenantId, otherTenantId, customerId, now, sale, mission };
}
