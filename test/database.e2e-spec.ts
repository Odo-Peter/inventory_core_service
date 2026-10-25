import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createStaff,
  createStore,
  createTestApp,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

describe('Database guardrails (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let staffId: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma)).id;
    staffId = (
      await createStaff(context, storeId, {
        staffCode: 'CASH001',
        role: 'cashier',
      })
    ).id;
  });

  it('enforces the one-open-shift-per-staff index', async () => {
    await context.prisma.shift.create({
      data: { store_id: storeId, staff_id: staffId },
    });

    await expect(
      context.prisma.shift.create({
        data: { store_id: storeId, staff_id: staffId },
      }),
    ).rejects.toThrow();

    const otherStaff = await createStaff(context, storeId, {
      staffCode: 'CASH002',
      role: 'cashier',
    });
    await expect(
      context.prisma.shift.create({
        data: { store_id: storeId, staff_id: otherStaff.id },
      }),
    ).resolves.toBeDefined();
  });

  it('rejects negative cash values', async () => {
    await expect(
      context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: staffId,
          opening_float: -1,
        },
      }),
    ).rejects.toThrow();

    await expect(
      context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: staffId,
          clock_out_at: new Date(),
          closing_cash_counted: -1,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a clock-out before the clock-in', async () => {
    await expect(
      context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: staffId,
          clock_in_at: new Date('2026-10-25T12:00:00.000Z'),
          clock_out_at: new Date('2026-10-25T11:59:59.000Z'),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects negative failed PIN attempts', async () => {
    await expect(
      context.prisma.staff.update({
        where: { id: staffId },
        data: { failed_pin_attempts: -1 },
      }),
    ).rejects.toThrow();
  });

  it('keeps the audit log append-only', async () => {
    const audit = await context.prisma.auditLog.create({
      data: {
        store_id: storeId,
        staff_id: staffId,
        action: 'test.action',
        entity_type: 'Test',
        entity_id: staffId,
        details: { value: true },
      },
    });

    await expect(
      context.prisma.auditLog.update({
        where: { id: audit.id },
        data: { action: 'test.changed' },
      }),
    ).rejects.toThrow();

    await expect(
      context.prisma.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();

    const stored = await context.prisma.auditLog.findUniqueOrThrow({
      where: { id: audit.id },
    });
    expect(stored.action).toBe('test.action');
  });
});
