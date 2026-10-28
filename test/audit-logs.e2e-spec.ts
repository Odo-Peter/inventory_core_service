import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client.js';
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

function auditPath(
  params: Record<string, string | number | undefined> = {},
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  const suffix = search.toString();
  return `/api/v1/audit-logs${suffix ? `?${suffix}` : ''}`;
}

describe('Audit logs (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let adminId: string;
  let adminToken: string;
  let managerToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    context.clock.set(new Date('2026-10-25T12:00:00.000Z'));
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma)).id;

    const admin = await createStaff(context, storeId, {
      staffCode: 'ADMIN001',
      role: 'admin',
    });
    adminId = admin.id;
    await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    adminToken = (await loginAs(context, 'ADMIN001')).token;
    managerToken = (await loginAs(context, 'MGR001')).token;
    cashierToken = (await loginAs(context, 'CASH001')).token;
  });

  function createAudit(
    overrides: Partial<Prisma.AuditLogUncheckedCreateInput> = {},
  ) {
    return context.prisma.auditLog.create({
      data: {
        store_id: storeId,
        staff_id: adminId,
        action: AUDIT_ACTIONS.staffUpdated,
        entity_type: 'Staff',
        entity_id: adminId,
        details: { fields: ['first_name'] },
        ...overrides,
      },
    });
  }

  it('requires an active admin', async () => {
    await request(context.app.getHttpServer()).get(auditPath()).expect(401);

    await request(context.app.getHttpServer())
      .get(auditPath())
      .set(bearer(cashierToken))
      .expect(403);

    await request(context.app.getHttpServer())
      .get(auditPath())
      .set(bearer(managerToken))
      .expect(403);

    await request(context.app.getHttpServer())
      .get(auditPath())
      .set(bearer(adminToken))
      .expect(200);

    await request(context.app.getHttpServer())
      .get('/api/v1/audit-logs/actions')
      .set(bearer(managerToken))
      .expect(403);

    await request(context.app.getHttpServer())
      .get('/api/v1/audit-logs/actions')
      .set(bearer(adminToken))
      .expect(200);

    const inactiveAdmin = await createStaff(context, storeId, {
      staffCode: 'ADMIN002',
      role: 'admin',
    });
    const inactiveToken = (await loginAs(context, 'ADMIN002')).token;
    const deactivated = await context.prisma.staff.update({
      where: { id: inactiveAdmin.id },
      data: { active: false, token_version: { increment: 1 } },
    });

    expect(deactivated.active).toBe(false);

    await request(context.app.getHttpServer())
      .get(auditPath())
      .set(bearer(inactiveToken))
      .expect(401)
      .expect((response) => {
        expect(response.body.code).toBe('unauthorized');
      });
  });

  it('returns known actions', async () => {
    const response = await request(context.app.getHttpServer())
      .get('/api/v1/audit-logs/actions')
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.actions).toEqual(Object.values(AUDIT_ACTIONS));
  });

  it('scopes results to the current store and returns the public shape', async () => {
    const visible = await createAudit({ entity_type: 'IsolationTarget' });

    const otherStore = await createStore(context.prisma, {
      name: 'Other Store',
    });
    const foreignStaff = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
    });
    await context.prisma.auditLog.create({
      data: {
        store_id: otherStore.id,
        staff_id: foreignStaff.id,
        action: AUDIT_ACTIONS.staffCreated,
        entity_type: 'IsolationTarget',
        entity_id: foreignStaff.id,
      },
    });

    const response = await request(context.app.getHttpServer())
      .get(auditPath({ entity_type: 'IsolationTarget' }))
      .set(bearer(adminToken))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(visible.id);
    expect(response.body.meta).toEqual({
      page: 1,
      page_size: 25,
      total: 1,
      total_pages: 1,
    });
    expect(Object.keys(response.body.data[0]).sort()).toEqual([
      'action',
      'actor',
      'created_at',
      'details',
      'entity_id',
      'entity_type',
      'id',
    ]);
    expect(response.body.data[0]).not.toHaveProperty('store_id');
    expect(response.body.data[0]).not.toHaveProperty('staff_id');
    expect(response.body.data[0]).not.toHaveProperty('staff');
  });

  it('filters by action, entity, staff, and date bounds', async () => {
    const otherStaff = await createStaff(context, storeId, {
      staffCode: 'CASH002',
    });
    const shiftId = '66666666-6666-4666-8666-666666666666';
    const first = new Date('2026-10-25T10:00:00.000Z');
    const second = new Date('2026-10-25T11:00:00.000Z');
    const third = new Date('2026-10-25T12:00:00.000Z');

    const staffCreated = await createAudit({
      action: AUDIT_ACTIONS.staffCreated,
      entity_type: 'Staff',
      entity_id: otherStaff.id,
      staff_id: otherStaff.id,
      created_at: first,
    });
    const shiftClosed = await createAudit({
      action: AUDIT_ACTIONS.shiftClockOut,
      entity_type: 'Shift',
      entity_id: shiftId,
      staff_id: otherStaff.id,
      created_at: second,
    });
    const shiftForced = await createAudit({
      action: AUDIT_ACTIONS.shiftForceClosed,
      entity_type: 'Shift',
      entity_id: shiftId,
      staff_id: adminId,
      created_at: third,
    });

    async function idsFor(
      params: Record<string, string | number | undefined>,
    ): Promise<string[]> {
      const response = await request(context.app.getHttpServer())
        .get(auditPath(params))
        .set(bearer(adminToken))
        .expect(200);
      return response.body.data.map((log: { id: string }) => log.id);
    }

    expect(await idsFor({ action: AUDIT_ACTIONS.staffCreated })).toEqual([
      staffCreated.id,
    ]);
    expect(await idsFor({ entity_type: 'Shift' })).toEqual([
      shiftForced.id,
      shiftClosed.id,
    ]);
    expect(await idsFor({ entity_id: shiftId })).toEqual([
      shiftForced.id,
      shiftClosed.id,
    ]);
    expect(await idsFor({ staff_id: otherStaff.id })).toEqual([
      shiftClosed.id,
      staffCreated.id,
    ]);
    expect(
      await idsFor({
        from: second.toISOString(),
        to: third.toISOString(),
      }),
    ).toEqual([shiftClosed.id]);
    expect(
      await idsFor({
        from: first.toISOString(),
        to: second.toISOString(),
      }),
    ).toEqual([staffCreated.id]);

    await request(context.app.getHttpServer())
      .get(auditPath({ action: 'not.an.action' }))
      .set(bearer(adminToken))
      .expect(400);
    await request(context.app.getHttpServer())
      .get(auditPath({ entity_id: 'not-a-uuid' }))
      .set(bearer(adminToken))
      .expect(400);
    await request(context.app.getHttpServer())
      .get(auditPath({ staff_id: 'not-a-uuid' }))
      .set(bearer(adminToken))
      .expect(400);
    await request(context.app.getHttpServer())
      .get(auditPath({ from: 'not-a-date' }))
      .set(bearer(adminToken))
      .expect(400);
    await request(context.app.getHttpServer())
      .get(
        auditPath({
          from: third.toISOString(),
          to: second.toISOString(),
        }),
      )
      .set(bearer(adminToken))
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('invalid_date_range');
      });
    for (const params of [
      { page: 0 },
      { page: -1 },
      { page: 1.5 },
      { page: 'abc' },
      { page: 10_001 },
      { page_size: 0 },
      { page_size: 101 },
      { page_size: 'abc' },
      { cursor: 'not-a-cursor' },
      { limit: 2 },
    ]) {
      await request(context.app.getHttpServer())
        .get(auditPath(params))
        .set(bearer(adminToken))
        .expect(400);
    }

    await request(context.app.getHttpServer())
      .get(
        auditPath({
          action: 'not.an.action',
          page: 1,
          page_size: 2,
        }),
      )
      .set(bearer(adminToken))
      .expect(400);
  });

  it('applies defaults and returns page metadata with a stable total', async () => {
    for (let index = 0; index < 30; index += 1) {
      await createAudit({
        action: AUDIT_ACTIONS.staffCreated,
        entity_type: 'DefaultPageTarget',
      });
    }

    const filter = { action: AUDIT_ACTIONS.staffCreated };
    const first = await request(context.app.getHttpServer())
      .get(auditPath(filter))
      .set(bearer(adminToken))
      .expect(200);
    const second = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 2 }))
      .set(bearer(adminToken))
      .expect(200);
    const largerPage = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 1, page_size: 100 }))
      .set(bearer(adminToken))
      .expect(200);

    expect(first.body.meta).toEqual({
      page: 1,
      page_size: 25,
      total: 30,
      total_pages: 2,
    });
    expect(second.body.meta).toEqual({
      page: 2,
      page_size: 25,
      total: 30,
      total_pages: 2,
    });
    expect(largerPage.body.meta).toEqual({
      page: 1,
      page_size: 100,
      total: 30,
      total_pages: 1,
    });
    expect(first.body.data).toHaveLength(25);
    expect(second.body.data).toHaveLength(5);
    expect(largerPage.body.data).toHaveLength(30);
  });

  it('paginates identical timestamps without gaps or duplicates', async () => {
    const createdAt = new Date('2026-10-25T09:00:00.000Z');
    const created = [];

    for (let index = 0; index < 5; index += 1) {
      created.push(
        await createAudit({
          action: AUDIT_ACTIONS.staffCreated,
          created_at: createdAt,
        }),
      );
    }

    const filter = {
      action: AUDIT_ACTIONS.staffCreated,
      page_size: 2,
    };
    const first = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 1 }))
      .set(bearer(adminToken))
      .expect(200);
    const second = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 2 }))
      .set(bearer(adminToken))
      .expect(200);
    const third = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 3 }))
      .set(bearer(adminToken))
      .expect(200);
    const beyond = await request(context.app.getHttpServer())
      .get(auditPath({ ...filter, page: 4 }))
      .set(bearer(adminToken))
      .expect(200);

    const ids = [
      ...first.body.data,
      ...second.body.data,
      ...third.body.data,
    ].map((log: { id: string }) => log.id);

    expect(ids).toHaveLength(created.length);
    expect(new Set(ids).size).toBe(created.length);
    expect([...ids].sort()).toEqual(created.map((log) => log.id).sort());
    expect([
      first.body.data.length,
      second.body.data.length,
      third.body.data.length,
    ]).toEqual([2, 2, 1]);
    expect(first.body.meta).toEqual({
      page: 1,
      page_size: 2,
      total: 5,
      total_pages: 3,
    });
    expect(third.body.meta).toEqual({
      page: 3,
      page_size: 2,
      total: 5,
      total_pages: 3,
    });
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta).toEqual({
      page: 4,
      page_size: 2,
      total: 5,
      total_pages: 3,
    });
    expect(first.body).not.toHaveProperty('next_cursor');
  });

  it('paginates date-filtered rows with matching totals', async () => {
    const inRange = new Date('2026-10-25T10:00:00.000Z');
    const outOfRange = new Date('2026-10-27T10:00:00.000Z');

    for (let index = 0; index < 5; index += 1) {
      await createAudit({
        action: AUDIT_ACTIONS.staffCreated,
        entity_type: 'DatePageTarget',
        created_at: inRange,
      });
    }
    for (let index = 0; index < 2; index += 1) {
      await createAudit({
        action: AUDIT_ACTIONS.staffCreated,
        entity_type: 'DatePageTarget',
        created_at: outOfRange,
      });
    }

    const filter = {
      entity_type: 'DatePageTarget',
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
      page_size: 2,
    };
    const pages = await Promise.all(
      [1, 2, 3].map((page) =>
        request(context.app.getHttpServer())
          .get(auditPath({ ...filter, page }))
          .set(bearer(adminToken))
          .expect(200),
      ),
    );

    expect(pages.map((page) => page.body.data.length)).toEqual([2, 2, 1]);
    expect(pages[0].body.meta).toEqual({
      page: 1,
      page_size: 2,
      total: 5,
      total_pages: 3,
    });
    expect(
      new Set(
        pages.flatMap((page) =>
          page.body.data.map((row: { id: string }) => row.id),
        ),
      ).size,
    ).toBe(5);
  });

  it('redacts sensitive details and still resolves inactive actors', async () => {
    const formerStaff = await createStaff(context, storeId, {
      staffCode: 'FORMER',
      role: 'manager',
      active: false,
    });
    const createdAt = new Date('2026-10-25T12:00:00.000Z');
    const log = await createAudit({
      staff_id: formerStaff.id,
      created_at: createdAt,
      details: {
        phone: '+234803****123',
        phone_from: '+234803****567',
        phone_to: '+234803****999',
        unmasked_phone: '+2348031234567',
        email: 'ada@example.com',
        token: 'secret-token',
        credentials: {
          password: 'secret-password',
          keep: 'visible',
        },
        nested: {
          email: 'nested@example.com',
          list: [
            { phone_number: '+2348031234567', label: 'kept' },
            { pin_hash: 'secret-hash', count: 2 },
          ],
        },
        fields: ['phone'],
      },
    });
    const arrayDetails = await createAudit({
      entity_id: '77777777-7777-4777-8777-777777777777',
      details: ['phone', '+2348031234567'],
    });

    const response = await request(context.app.getHttpServer())
      .get(auditPath({ page_size: 100 }))
      .set(bearer(adminToken))
      .expect(200);

    const item = response.body.data.find(
      (entry: { id: string }) => entry.id === log.id,
    );
    const arrayItem = response.body.data.find(
      (entry: { id: string }) => entry.id === arrayDetails.id,
    );

    expect(item.actor).toEqual({
      id: formerStaff.id,
      name: 'Test Staff',
      staff_code: 'FORMER',
      role: 'manager',
    });
    expect(item.details).toEqual({
      phone: '+234803****123',
      phone_from: '+234803****567',
      phone_to: '+234803****999',
      credentials: { keep: 'visible' },
      nested: {
        list: [{ label: 'kept' }, { count: 2 }],
      },
      fields: ['phone'],
    });
    expect(arrayItem.details).toBeNull();

    const serialized = JSON.stringify(item.details);
    expect(serialized).not.toContain('+2348031234567');
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain('nested@example.com');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('secret-hash');
    expect(item).not.toHaveProperty('store_id');
  });

  it('does not write audit rows when reading', async () => {
    await createAudit();
    const before = await context.prisma.auditLog.count();

    await request(context.app.getHttpServer())
      .get(auditPath())
      .set(bearer(adminToken))
      .expect(200);
    await request(context.app.getHttpServer())
      .get('/api/v1/audit-logs/actions')
      .set(bearer(adminToken))
      .expect(200);

    expect(await context.prisma.auditLog.count()).toBe(before);
  });

  it('does not expose write routes', async () => {
    const log = await createAudit();
    const server = context.app.getHttpServer();

    await request(server)
      .post('/api/v1/audit-logs')
      .set(bearer(adminToken))
      .send({})
      .expect(404);
    await request(server)
      .patch(`/api/v1/audit-logs/${log.id}`)
      .set(bearer(adminToken))
      .send({})
      .expect(404);
    await request(server)
      .delete(`/api/v1/audit-logs/${log.id}`)
      .set(bearer(adminToken))
      .expect(404);
  });
});
