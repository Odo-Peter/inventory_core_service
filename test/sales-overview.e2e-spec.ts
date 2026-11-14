import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PaymentMethod, StaffRole } from '../src/generated/prisma/enums.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const NOW = new Date('2026-11-14T12:00:00.000Z');

describe('Sales overview (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let cashierId: string;
  let tokens: Record<StaffRole, string>;
  let receiptNumber = 0;
  const shifts = new Map<string, { id: string }>();

  const server = () => context.app.getHttpServer();

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
    context.clock.set(NOW);
    receiptNumber = 0;
    shifts.clear();

    storeId = (
      await createStore(context.prisma, {
        name: 'Test Store',
        currency: 'NGN',
        timezone: 'Africa/Lagos',
      })
    ).id;

    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASHIER',
      role: 'cashier',
    });
    await createStaff(context, storeId, {
      staffCode: 'MANAGER',
      role: 'manager',
    });
    await createStaff(context, storeId, {
      staffCode: 'ADMIN',
      role: 'admin',
    });
    cashierId = cashier.id;

    tokens = {
      cashier: (await loginAs(context, 'CASHIER')).token,
      manager: (await loginAs(context, 'MANAGER')).token,
      admin: (await loginAs(context, 'ADMIN')).token,
    };
  });

  async function shiftFor(staffId: string, targetStoreId = storeId) {
    const key = `${targetStoreId}:${staffId}`;
    const cached = shifts.get(key);
    if (cached) return cached;

    const existing = await context.prisma.shift.findFirst({
      where: {
        store_id: targetStoreId,
        staff_id: staffId,
        clock_out_at: null,
      },
      select: { id: true },
    });
    if (existing) {
      shifts.set(key, existing);
      return existing;
    }

    const created = await context.prisma.shift.create({
      data: {
        store_id: targetStoreId,
        staff_id: staffId,
        clock_in_at: new Date('2026-11-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    shifts.set(key, created);
    return created;
  }

  async function createSale(options: {
    total: number;
    createdAt: Date;
    method?: PaymentMethod;
    staffId?: string;
    targetStoreId?: string;
  }) {
    receiptNumber += 1;
    const targetStoreId = options.targetStoreId ?? storeId;
    const staffId = options.staffId ?? cashierId;
    const shift = await shiftFor(staffId, targetStoreId);
    const method = options.method ?? 'cash';

    return context.prisma.sale.create({
      data: {
        store_id: targetStoreId,
        receipt_number: receiptNumber,
        shift_id: shift.id,
        staff_id: staffId,
        subtotal: options.total,
        total: options.total,
        created_at: options.createdAt,
        payment: {
          create: {
            method,
            amount: options.total,
          },
        },
      },
      select: { id: true },
    });
  }

  function getOverview(token: string) {
    return request(server())
      .get('/api/v1/sales/overview')
      .set(bearer(token));
  }

  it('zero-fills exactly seven days ending today', async () => {
    const response = await getOverview(tokens.manager).expect(200);

    expect(response.body).toEqual({
      timezone: 'Africa/Lagos',
      scope: 'store',
      today: {
        date: '2026-11-14',
        total: 0,
        count: 0,
        by_method: [],
      },
      daily: [
        { date: '2026-11-08', total: 0, count: 0 },
        { date: '2026-11-09', total: 0, count: 0 },
        { date: '2026-11-10', total: 0, count: 0 },
        { date: '2026-11-11', total: 0, count: 0 },
        { date: '2026-11-12', total: 0, count: 0 },
        { date: '2026-11-13', total: 0, count: 0 },
        { date: '2026-11-14', total: 0, count: 0 },
      ],
    });
  });

  it('uses the store timezone for the local day boundary', async () => {
    await createSale({
      total: 1_000,
      createdAt: new Date('2026-11-13T22:30:00.000Z'),
    });
    await createSale({
      total: 2_000,
      createdAt: new Date('2026-11-13T23:30:00.000Z'),
    });

    const response = await getOverview(tokens.manager).expect(200);
    const daily = response.body.daily as Array<{
      date: string;
      total: number;
      count: number;
    }>;

    expect(daily.find((day) => day.date === '2026-11-13')).toEqual({
      date: '2026-11-13',
      total: 1_000,
      count: 1,
    });
    expect(daily.find((day) => day.date === '2026-11-14')).toEqual({
      date: '2026-11-14',
      total: 2_000,
      count: 1,
    });
    expect(response.body.today).toEqual({
      date: '2026-11-14',
      total: 2_000,
      count: 1,
      by_method: [{ method: 'cash', total: 2_000, count: 1 }],
    });
  });

  it('handles a negative-offset store and a sale near midnight UTC', async () => {
    await context.prisma.store.update({
      where: { id: storeId },
      data: { timezone: 'America/New_York' },
    });

    await createSale({
      total: 500,
      createdAt: new Date('2026-11-14T00:30:00.000Z'),
    });
    await createSale({
      total: 700,
      createdAt: new Date('2026-11-14T05:30:00.000Z'),
    });

    const response = await getOverview(tokens.manager).expect(200);
    const daily = response.body.daily as Array<{
      date: string;
      total: number;
      count: number;
    }>;

    expect(response.body.timezone).toBe('America/New_York');
    expect(daily.find((day) => day.date === '2026-11-13')).toEqual({
      date: '2026-11-13',
      total: 500,
      count: 1,
    });
    expect(daily.find((day) => day.date === '2026-11-14')).toEqual({
      date: '2026-11-14',
      total: 700,
      count: 1,
    });
    expect(response.body.today.date).toBe('2026-11-14');
    expect(response.body.today.total).toBe(700);
    expect(response.body.today.count).toBe(1);
  });

  it('scopes cashiers to their own sales and managers/admins to the store', async () => {
    const otherCashier = await createStaff(context, storeId, {
      staffCode: 'CASHIER2',
      role: 'cashier',
    });

    await createSale({
      total: 1_000,
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
    });
    await createSale({
      total: 2_500,
      createdAt: new Date('2026-11-14T10:30:00.000Z'),
      staffId: otherCashier.id,
    });

    const otherStore = await createStore(context.prisma, {
      name: 'Other Store',
      timezone: 'Africa/Lagos',
    });
    const foreignCashier = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
      role: 'cashier',
    });
    await createSale({
      total: 9_000,
      createdAt: new Date('2026-11-14T10:45:00.000Z'),
      staffId: foreignCashier.id,
      targetStoreId: otherStore.id,
    });

    const own = await getOverview(tokens.cashier).expect(200);
    expect(own.body.scope).toBe('own');
    expect(own.body.today).toMatchObject({
      date: '2026-11-14',
      total: 1_000,
      count: 1,
    });

    const manager = await getOverview(tokens.manager).expect(200);
    expect(manager.body.scope).toBe('store');
    expect(manager.body.today).toMatchObject({
      date: '2026-11-14',
      total: 3_500,
      count: 2,
    });

    const admin = await getOverview(tokens.admin).expect(200);
    expect(admin.body.scope).toBe('store');
    expect(admin.body.today).toMatchObject({
      date: '2026-11-14',
      total: 3_500,
      count: 2,
    });
  });

  it('returns integer kobo and a by_method breakdown that sums to today', async () => {
    await createSale({
      total: 1_000,
      createdAt: new Date('2026-11-14T09:00:00.000Z'),
    });
    await createSale({
      total: 2_000,
      createdAt: new Date('2026-11-14T09:30:00.000Z'),
    });
    await createSale({
      total: 500,
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
      method: 'card',
    });
    await createSale({
      total: 999,
      createdAt: new Date('2026-11-13T10:00:00.000Z'),
    });

    const response = await getOverview(tokens.manager).expect(200);
    const today = response.body.today as {
      total: number;
      count: number;
      by_method: Array<{ method: PaymentMethod; total: number; count: number }>;
    };

    expect(today.total).toBe(3_500);
    expect(today.count).toBe(3);
    expect(today.by_method).toEqual([
      { method: 'card', total: 500, count: 1 },
      { method: 'cash', total: 3_000, count: 2 },
    ]);
    expect(
      today.by_method.reduce((sum, method) => sum + method.total, 0),
    ).toBe(today.total);
    expect(
      today.by_method.reduce((sum, method) => sum + method.count, 0),
    ).toBe(today.count);

    for (const day of response.body.daily as Array<{
      total: number;
      count: number;
    }>) {
      expect(Number.isInteger(day.total)).toBe(true);
      expect(Number.isInteger(day.count)).toBe(true);
    }
    for (const method of today.by_method) {
      expect(Number.isInteger(method.total)).toBe(true);
      expect(Number.isInteger(method.count)).toBe(true);
    }
  });

  it('does not let /sales/:id capture /sales/overview', async () => {
    const response = await getOverview(tokens.cashier).expect(200);

    expect(response.body).toMatchObject({
      timezone: 'Africa/Lagos',
      scope: 'own',
    });
    expect(response.body.daily).toHaveLength(7);
  });
});
