import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runSeed } from '../prisma/seed.js';
import {
  createTestApp,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const BASE_ENV = {
  SEED_STORE_NAME: 'Seed Store',
  SEED_STORE_CURRENCY: 'NGN',
  SEED_STORE_TIMEZONE: 'Africa/Lagos',
  SEED_ADMIN_CODE: 'ADMIN001',
  SEED_ADMIN_FIRST_NAME: 'Ada',
  SEED_ADMIN_LAST_NAME: 'Okafor',
  SEED_ADMIN_PHONE: '08031234567',
  SEED_ADMIN_PIN: '246810',
  PIN_PEPPER: 'test-pin-pepper-with-16-bytes',
};

function seedEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...BASE_ENV, ...overrides };
}

async function captureSeedError(
  context: TestContext,
  env: NodeJS.ProcessEnv,
): Promise<Error> {
  try {
    await runSeed(context.prisma, env);
  } catch (error: unknown) {
    return error as Error;
  }

  throw new Error('Expected seeding to fail');
}

describe('Database seed (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
  });

  it('creates the admin with a normalized phone', async () => {
    await runSeed(context.prisma, seedEnv());

    const admin = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    expect(admin).toMatchObject({
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: '+2348031234567',
      role: 'admin',
      active: true,
    });
    await expect(
      context.pinHasher.verify(admin.pin_hash, '246810'),
    ).resolves.toBe(true);
  });

  it('is idempotent on a second run', async () => {
    await runSeed(context.prisma, seedEnv());
    const first = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    await runSeed(context.prisma, seedEnv());
    const second = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    expect(second.updated_at).toEqual(first.updated_at);
    expect(second.pin_hash).toBe(first.pin_hash);
    expect(second.token_version).toBe(first.token_version);
  });

  it('seeds catalog items with opening stock movements and POS accounts', async () => {
    await runSeed(context.prisma, seedEnv());

    expect(await context.prisma.category.count()).toBeGreaterThanOrEqual(3);
    const items = await context.prisma.item.findMany({
      include: { stock_movements: true },
    });
    expect(items).toHaveLength(4);

    for (const item of items) {
      expect(item.stock_quantity).toBeGreaterThan(0);
      expect(item.stock_movements).toHaveLength(1);
      expect(item.stock_movements[0]).toMatchObject({
        reason: 'initial',
        quantity_change: item.stock_quantity,
      });
    }

    const accounts = await context.prisma.pOSAccount.findMany();
    expect(accounts.map((account) => account.type).sort((a, b) => a.localeCompare(b))).toEqual([
      'bank_account',
      'pos_terminal',
    ]);
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'stock.initialized' },
      }),
    ).toBe(4);
  });

  it('does not duplicate catalog stock or POS accounts on rerun', async () => {
    await runSeed(context.prisma, seedEnv());
    const firstItems = await context.prisma.item.findMany({
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, stock_quantity: true },
    });
    const firstMovements = await context.prisma.stockMovement.count();
    const firstAccounts = await context.prisma.pOSAccount.count();

    await runSeed(context.prisma, seedEnv());

    const secondItems = await context.prisma.item.findMany({
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, stock_quantity: true },
    });
    expect(secondItems).toEqual(firstItems);
    expect(await context.prisma.stockMovement.count()).toBe(firstMovements);
    expect(await context.prisma.auditLog.count({
      where: { action: 'stock.initialized' },
    })).toBe(firstMovements);
    expect(await context.prisma.pOSAccount.count()).toBe(firstAccounts);
  });

  it('updates only the phone when only SEED_ADMIN_PHONE changes', async () => {
    await runSeed(context.prisma, seedEnv());
    const first = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    await runSeed(
      context.prisma,
      seedEnv({ SEED_ADMIN_PHONE: '08039999999' }),
    );
    const second = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    expect(second.phone).toBe('+2348039999999');
    expect(second.first_name).toBe(first.first_name);
    expect(second.last_name).toBe(first.last_name);
    expect(second.pin_hash).toBe(first.pin_hash);
  });

  it('updates only the last name when only SEED_ADMIN_LAST_NAME changes', async () => {
    await runSeed(context.prisma, seedEnv());
    const first = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    await runSeed(
      context.prisma,
      seedEnv({ SEED_ADMIN_LAST_NAME: 'Nwosu' }),
    );
    const second = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });

    expect(second.first_name).toBe('Ada');
    expect(second.last_name).toBe('Nwosu');
    expect(second.phone).toBe(first.phone);
    expect(second.pin_hash).toBe(first.pin_hash);
  });

  it.each([
    'SEED_ADMIN_FIRST_NAME',
    'SEED_ADMIN_LAST_NAME',
    'SEED_ADMIN_PHONE',
  ])('fails fast when %s is missing', async (variable) => {
    const env = seedEnv();
    delete env[variable];

    const error = await captureSeedError(context, env);

    expect(error.message).toContain(variable);
    expect(error.message).not.toContain(BASE_ENV.SEED_ADMIN_PIN);
  });

  it('fails fast for an invalid phone without printing the PIN', async () => {
    const error = await captureSeedError(
      context,
      seedEnv({ SEED_ADMIN_PHONE: '06031234567' }),
    );

    expect(error.message).toMatch(/valid Nigerian mobile number/);
    expect(error.message).not.toContain(BASE_ENV.SEED_ADMIN_PIN);
  });
});

describe('Staff schema (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
  });

  it('requires first_name, last_name and phone', async () => {
    const store = await context.prisma.store.create({
      data: {
        name: 'Schema Store',
        currency: 'NGN',
        timezone: 'Africa/Lagos',
      },
    });
    const base = {
      store_id: store.id,
      staff_code: 'MISSING001',
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: '+2348031234567',
      pin_hash: 'not-a-real-hash',
    };

    for (const field of ['first_name', 'last_name', 'phone']) {
      const data = { ...base, staff_code: `MISSING_${field}` };
      delete data[field as keyof typeof data];

      await expect(
        context.prisma.staff.create({ data: data as never }),
      ).rejects.toThrow();
    }
  });

  it('has no name column on Staff', async () => {
    const columns = await context.prisma.$queryRaw<
      Array<{ column_name: string }>
    >`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Staff'
    `;

    const names = columns.map((column) => column.column_name);
    expect(names).toContain('first_name');
    expect(names).toContain('last_name');
    expect(names).toContain('phone');
    expect(names).not.toContain('name');
  });

  it('has no unique index on phone', async () => {
    const indexes = await context.prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Staff'
    `;

    expect(
      indexes.some(
        (index) =>
          /UNIQUE INDEX/i.test(index.indexdef) && /\(phone\)/.test(index.indexdef),
      ),
    ).toBe(false);
  });
});
