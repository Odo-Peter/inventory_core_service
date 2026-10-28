import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

describe('Shifts (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let adminToken: string;
  let managerToken: string;
  let cashierToken: string;
  let cashierId: string;
  let managerId: string;
  let adminId: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    context.clock.set(new Date('2026-10-25T12:00:00.000Z'));
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma, { timezone: 'Africa/Lagos' }))
      .id;

    const admin = await createStaff(context, storeId, {
      staffCode: 'ADMIN001',
      role: 'admin',
    });
    const manager = await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });
    adminId = admin.id;
    managerId = manager.id;
    cashierId = cashier.id;

    adminToken = (await loginAs(context, 'ADMIN001')).token;
    managerToken = (await loginAs(context, 'MGR001')).token;
    cashierToken = (await loginAs(context, 'CASH001')).token;
  });

  it('opens and closes a shift with normal close metadata', async () => {
    const opened = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 5_000, opening_notes: 'Start' })
      .expect(201);

    expect(opened.body).toMatchObject({
      store_id: storeId,
      staff_id: cashierId,
      opening_float: 5_000,
      opening_notes: 'Start',
      clock_out_at: null,
      close_reason: null,
    });
    expect(new Date(opened.body.clock_in_at).toISOString()).toBe(
      '2026-10-25T12:00:00.000Z',
    );

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 0 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('staff_has_open_shift');
      });

    const current = await request(context.app.getHttpServer())
      .get('/api/v1/shifts/current')
      .set(bearer(cashierToken))
      .expect(200);
    expect(current.body.id).toBe(opened.body.id);

    const closed = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(cashierToken))
      .send({
        closing_cash_counted: 5_500,
        closing_notes: 'End',
      })
      .expect(200);

    expect(closed.body).toMatchObject({
      id: opened.body.id,
      closing_cash_counted: 5_500,
      closing_notes: 'End',
      closed_by_staff_id: cashierId,
      close_reason: 'normal',
    });
    expect(new Date(closed.body.clock_out_at).toISOString()).toBe(
      '2026-10-25T12:00:00.000Z',
    );

    await request(context.app.getHttpServer())
      .get('/api/v1/shifts/current')
      .set(bearer(cashierToken))
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({});
      });

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(cashierToken))
      .send({ closing_cash_counted: 0 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('shift_not_open');
      });

    const audits = await context.prisma.auditLog.findMany({
      where: {
        store_id: storeId,
        entity_id: opened.body.id,
      },
      orderBy: { created_at: 'asc' },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      AUDIT_ACTIONS.shiftClockIn,
      AUDIT_ACTIONS.shiftClockOut,
    ]);
  });

  it('allows cashiers and managers to start shifts but rejects admins', async () => {
    const managerShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(managerToken))
      .send({ opening_float: 2_500 })
      .expect(201);

    expect(managerShift.body).toMatchObject({
      staff_id: managerId,
      opening_float: 2_500,
      clock_out_at: null,
    });

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(managerToken))
      .send({ opening_float: 0 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('staff_has_open_shift');
      });

    const denied = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(adminToken))
      .send({ opening_float: 0 })
      .expect(403);

    expect(denied.body).toMatchObject({
      code: 'forbidden',
      message: 'Admins cannot start or close shifts. Use force-close instead.',
    });

    expect(
      await context.prisma.shift.count({
        where: { staff_id: adminId, clock_out_at: null },
      }),
    ).toBe(0);
    expect(
      await context.prisma.auditLog.count({
        where: {
          store_id: storeId,
          action: AUDIT_ACTIONS.shiftClockIn,
          staff_id: adminId,
        },
      }),
    ).toBe(0);

    const cashierShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 0 })
      .expect(201);

    expect(cashierShift.body.staff_id).toBe(cashierId);
  });

  it('allows owners to close normally, but blocks admins and non-owners', async () => {
    const managerShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(managerToken))
      .send({ opening_float: 1_000 })
      .expect(201);

    const closed = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(managerToken))
      .send({ closing_cash_counted: 1_100 })
      .expect(200);

    expect(closed.body).toMatchObject({
      id: managerShift.body.id,
      staff_id: managerId,
      closed_by_staff_id: managerId,
      close_reason: 'normal',
      closing_cash_counted: 1_100,
    });

    const legacyAdminShift = await context.prisma.shift.create({
      data: {
        store_id: storeId,
        staff_id: adminId,
        clock_in_at: new Date('2026-10-25T10:00:00.000Z'),
      },
    });

    const adminDenied = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(adminToken))
      .send({ closing_cash_counted: 0 })
      .expect(403);

    expect(adminDenied.body).toMatchObject({
      code: 'forbidden',
      message: 'Admins cannot start or close shifts. Use force-close instead.',
    });

    const legacyAdminAfter = await context.prisma.shift.findUniqueOrThrow({
      where: { id: legacyAdminShift.id },
    });
    expect(legacyAdminAfter.clock_out_at).toBeNull();

    const otherManager = await createStaff(context, storeId, {
      staffCode: 'MGR002',
      role: 'manager',
    });
    const otherManagerToken = (await loginAs(context, 'MGR002')).token;
    const otherManagerShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(otherManagerToken))
      .send({ opening_float: 0 })
      .expect(201);

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(managerToken))
      .send({ closing_cash_counted: 0 })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('not_shift_owner');
      });

    const otherManagerOpen = await context.prisma.shift.findUniqueOrThrow({
      where: { id: otherManagerShift.body.id },
    });
    expect(otherManagerOpen.clock_out_at).toBeNull();
    expect(otherManagerOpen.staff_id).toBe(otherManager.id);

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(otherManagerToken))
      .send({ closing_cash_counted: 0 })
      .expect(200);
  });

  it('returns a null active_shift_id for admins even with a legacy open shift', async () => {
    await context.prisma.shift.create({
      data: {
        store_id: storeId,
        staff_id: adminId,
        clock_in_at: new Date('2026-10-25T10:00:00.000Z'),
      },
    });

    const me = await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(adminToken))
      .expect(200);

    expect(me.body.active_shift_id).toBeNull();
  });

  it('prevents cashiers from closing someone else shift', async () => {
    const other = await createStaff(context, storeId, {
      staffCode: 'CASH002',
      role: 'cashier',
    });
    const otherToken = (await loginAs(context, 'CASH002')).token;

    const opened = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 0 })
      .expect(201);

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(otherToken))
      .send({ closing_cash_counted: 0 })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('not_shift_owner');
      });

    const current = await request(context.app.getHttpServer())
      .get('/api/v1/shifts/current')
      .set(bearer(otherToken))
      .expect(200);
    expect(current.body).toEqual({});

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(cashierToken))
      .send({ closing_cash_counted: 0 })
      .expect(200);

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-out')
      .set(bearer(otherToken))
      .send({ closing_cash_counted: 0 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('no_open_shift');
      });

    expect(other.id).not.toBe(opened.body.staff_id);
  });

  it('allows only one of two concurrent clock-ins', async () => {
    const responses = await Promise.all([
      request(context.app.getHttpServer())
        .post('/api/v1/shifts/clock-in')
        .set(bearer(cashierToken))
        .send({ opening_float: 0 }),
      request(context.app.getHttpServer())
        .post('/api/v1/shifts/clock-in')
        .set(bearer(cashierToken))
        .send({ opening_float: 0 }),
    ]);

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(
      await context.prisma.shift.count({
        where: { staff_id: cashierId, clock_out_at: null },
      }),
    ).toBe(1);
  });

  it('pages shifts with page metadata, filters, and stable ordering', async () => {
    const clockIn = new Date('2026-10-20T10:00:00.000Z');
    const createdIds: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const created = await context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: cashierId,
          clock_in_at: clockIn,
          clock_out_at: new Date(clockIn.getTime() + 1_800_000),
          close_reason: 'normal',
          closed_by_staff_id: cashierId,
        },
      });
      createdIds.push(created.id);
    }

    const otherCashier = await createStaff(context, storeId, {
      staffCode: 'CASH002',
      role: 'cashier',
    });
    const otherShift = await context.prisma.shift.create({
      data: {
        store_id: storeId,
        staff_id: otherCashier.id,
        clock_in_at: new Date('2026-10-21T10:00:00.000Z'),
        clock_out_at: new Date('2026-10-21T11:00:00.000Z'),
        close_reason: 'normal',
      },
    });
    createdIds.push(otherShift.id);

    const otherStore = await createStore(context.prisma, {
      name: 'Other Store',
    });
    const foreignStaff = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
    });
    await context.prisma.shift.create({
      data: {
        store_id: otherStore.id,
        staff_id: foreignStaff.id,
        clock_in_at: new Date('2026-10-20T10:00:00.000Z'),
        clock_out_at: new Date('2026-10-20T11:00:00.000Z'),
        close_reason: 'normal',
      },
    });

    const all = await request(context.app.getHttpServer())
      .get('/api/v1/shifts')
      .set(bearer(managerToken))
      .expect(200);
    expect(all.body.meta).toEqual({
      page: 1,
      page_size: 25,
      total: 6,
      total_pages: 1,
    });
    expect(all.body.data).toHaveLength(6);

    const first = await request(context.app.getHttpServer())
      .get('/api/v1/shifts?page_size=2&page=1')
      .set(bearer(managerToken))
      .expect(200);
    const second = await request(context.app.getHttpServer())
      .get('/api/v1/shifts?page_size=2&page=2')
      .set(bearer(managerToken))
      .expect(200);
    const third = await request(context.app.getHttpServer())
      .get('/api/v1/shifts?page_size=2&page=3')
      .set(bearer(managerToken))
      .expect(200);
    const beyond = await request(context.app.getHttpServer())
      .get('/api/v1/shifts?page_size=2&page=4')
      .set(bearer(managerToken))
      .expect(200);

    const ids = [
      ...first.body.data,
      ...second.body.data,
      ...third.body.data,
    ].map((shift: { id: string }) => shift.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect([...ids].sort()).toEqual([...createdIds].sort());
    expect([
      first.body.data.length,
      second.body.data.length,
      third.body.data.length,
    ]).toEqual([2, 2, 2]);
    expect(first.body.meta).toEqual({
      page: 1,
      page_size: 2,
      total: 6,
      total_pages: 3,
    });
    expect(third.body.meta).toEqual({
      page: 3,
      page_size: 2,
      total: 6,
      total_pages: 3,
    });
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta).toEqual({
      page: 4,
      page_size: 2,
      total: 6,
      total_pages: 3,
    });
    expect(first.body).not.toHaveProperty('next_cursor');

    const filtered = await request(context.app.getHttpServer())
      .get(`/api/v1/shifts?staff_id=${otherCashier.id}&page_size=1`)
      .set(bearer(managerToken))
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].staff_id).toBe(otherCashier.id);
    expect(filtered.body.meta).toEqual({
      page: 1,
      page_size: 1,
      total: 1,
      total_pages: 1,
    });

    await request(context.app.getHttpServer())
      .get('/api/v1/shifts?from=2026-13-01')
      .set(bearer(managerToken))
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('invalid_date');
      });

    for (const params of [
      'page=0',
      'page=-1',
      'page=1.5',
      'page=abc',
      'page=10001',
      'page_size=0',
      'page_size=101',
      'page_size=abc',
      'cursor=00000000-0000-4000-8000-000000000000',
      'limit=2',
    ]) {
      await request(context.app.getHttpServer())
        .get(`/api/v1/shifts?${params}`)
        .set(bearer(managerToken))
        .expect(400);
    }
  });

  it('keeps shift staff links backed by refactored first and last names', async () => {
    const opened = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 0 })
      .expect(201);

    const list = await request(context.app.getHttpServer())
      .get(`/api/v1/shifts?staff_id=${cashierId}`)
      .set(bearer(managerToken))
      .expect(200);

    expect(list.body.data[0].id).toBe(opened.body.id);
    expect(list.body.data[0].staff_id).toBe(cashierId);

    const embedded = await context.prisma.shift.findUniqueOrThrow({
      where: { id: opened.body.id as string },
      include: {
        staff: { select: { first_name: true, last_name: true } },
      },
    });
    expect(embedded.staff).toEqual({
      first_name: 'Test',
      last_name: 'Staff',
    });
  });

  it('applies date filters in the store timezone', async () => {
    const shifts = [
      '2026-10-24T23:30:00.000Z',
      '2026-10-25T22:30:00.000Z',
      '2026-10-25T23:30:00.000Z',
    ];

    for (const clockIn of shifts) {
      const from = new Date(clockIn);
      await context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: cashierId,
          clock_in_at: from,
          clock_out_at: new Date(from.getTime() + 1_800_000),
          close_reason: 'normal',
        },
      });
    }

    const response = await request(context.app.getHttpServer())
      .get('/api/v1/shifts?from=2026-10-25&to=2026-10-25')
      .set(bearer(managerToken))
      .expect(200);

    expect(
      response.body.data.map((shift: { clock_in_at: string }) =>
        new Date(shift.clock_in_at).toISOString(),
      ),
    ).toEqual(['2026-10-25T22:30:00.000Z', '2026-10-24T23:30:00.000Z']);
  });

  it('force-closes with the tiered role matrix and records the audit', async () => {
    const cashierShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 1_000 })
      .expect(201);

    const forced = await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${cashierShift.body.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: 'Cashier left', closing_cash_counted: 900 })
      .expect(200);

    expect(forced.body).toMatchObject({
      close_reason: 'forced',
      closed_by_staff_id: managerId,
      closing_notes: 'Cashier left',
      closing_cash_counted: 900,
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${cashierShift.body.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: 'Again' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('shift_not_open');
      });

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.shiftForceClosed,
        entity_id: cashierShift.body.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).toMatchObject({
      reason: 'Cashier left',
      target_staff_id: cashierId,
      closed_by_staff_id: managerId,
    });

    const managerShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(managerToken))
      .send({ opening_float: 0 })
      .expect(201);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${managerShift.body.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: 'Own shift' })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('insufficient_role');
        expect(response.body.message).toBe(
          'Managers can only force-close cashier shifts',
        );
      });

    const managerShiftOpen = await context.prisma.shift.findUniqueOrThrow({
      where: { id: managerShift.body.id },
    });
    expect(managerShiftOpen.clock_out_at).toBeNull();
    expect(
      await context.prisma.auditLog.count({
        where: {
          action: AUDIT_ACTIONS.shiftForceClosed,
          entity_id: managerShift.body.id,
        },
      }),
    ).toBe(0);

    const adminShift = await context.prisma.shift.create({
      data: {
        store_id: storeId,
        staff_id: adminId,
        clock_in_at: new Date('2026-10-25T10:00:00.000Z'),
      },
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${adminShift.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: 'Not allowed' })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('insufficient_role');
      });

    const adminShiftOpen = await context.prisma.shift.findUniqueOrThrow({
      where: { id: adminShift.id },
    });
    expect(adminShiftOpen.clock_out_at).toBeNull();
    expect(
      await context.prisma.auditLog.count({
        where: {
          action: AUDIT_ACTIONS.shiftForceClosed,
          entity_id: adminShift.id,
        },
      }),
    ).toBe(0);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${managerShift.body.id}/force-close`)
      .set(bearer(adminToken))
      .send({ reason: 'Admin override' })
      .expect(200);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${adminShift.id}/force-close`)
      .set(bearer(adminToken))
      .send({ reason: 'Legacy admin shift' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          close_reason: 'forced',
          closed_by_staff_id: adminId,
          closing_notes: 'Legacy admin shift',
        });
      });

    const otherCashier = await createStaff(context, storeId, {
      staffCode: 'CASH002',
      role: 'cashier',
    });
    const otherCashierToken = (await loginAs(context, 'CASH002')).token;
    const otherCashierShift = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(otherCashierToken))
      .send({ opening_float: 0 })
      .expect(201);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${otherCashierShift.body.id}/force-close`)
      .set(bearer(otherCashierToken))
      .send({ reason: 'Cashier cannot' })
      .expect(403);

    const otherCashierOpen = await context.prisma.shift.findUniqueOrThrow({
      where: { id: otherCashierShift.body.id },
    });
    expect(otherCashierOpen.clock_out_at).toBeNull();
    expect(otherCashier.id).toBe(otherCashierShift.body.staff_id);
    expect(
      await context.prisma.auditLog.count({
        where: {
          action: AUDIT_ACTIONS.shiftForceClosed,
          entity_id: otherCashierShift.body.id,
        },
      }),
    ).toBe(0);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${otherCashierShift.body.id}/force-close`)
      .set(bearer(adminToken))
      .send({ reason: 'Admin closes cashier shift' })
      .expect(200);
  });

  it('rejects force-close for missing or foreign shifts', async () => {
    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/00000000-0000-4000-8000-000000000000/force-close')
      .set(bearer(managerToken))
      .send({ reason: 'Missing' })
      .expect(404);

    const otherStore = await createStore(context.prisma, {
      name: 'Other Store',
      active: false,
    });
    const foreignStaff = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
      role: 'cashier',
    });
    const foreignShift = await context.prisma.shift.create({
      data: {
        store_id: otherStore.id,
        staff_id: foreignStaff.id,
      },
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${foreignShift.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: 'Foreign' })
      .expect(404);
  });

  it('validates shift payloads', async () => {
    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: -1 })
      .expect(400);

    await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 1.5 })
      .expect(400);

    const opened = await request(context.app.getHttpServer())
      .post('/api/v1/shifts/clock-in')
      .set(bearer(cashierToken))
      .send({ opening_float: 0 })
      .expect(201);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${opened.body.id}/force-close`)
      .set(bearer(managerToken))
      .send({})
      .expect(400);

    await request(context.app.getHttpServer())
      .post(`/api/v1/shifts/${opened.body.id}/force-close`)
      .set(bearer(managerToken))
      .send({ reason: '' })
      .expect(400);

    expect(adminId).toBeTypeOf('string');
  });
});
