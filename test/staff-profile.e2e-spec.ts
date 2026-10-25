import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
import {
  authHeader,
  createStaff as createStaffFixture,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const VALID_CREATE = {
  staff_code: 'CASH001',
  first_name: 'Ada',
  last_name: 'Okafor',
  phone: '08031234567',
};

const NORMALIZED_PHONE = '+2348031234567';

const PHONE_FORMATS = [
  '08031234567',
  '8031234567',
  '2348031234567',
  '+2348031234567',
  '+234 0803 123 4567',
  '0803 123 4567',
  '0803-123-4567',
  '(0803) 123.4567',
];

describe('Staff profile management (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let adminToken: string;

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
    await createStaffFixture(context, storeId, {
      staff_code: 'ADMIN001',
      first_name: 'Admin',
      last_name: 'Staff',
      role: 'admin',
    });
    adminToken = (await loginAs(context, 'ADMIN001')).token;
  });

  function postStaff(payload: Record<string, unknown>) {
    return request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(authHeader(adminToken))
      .send(payload);
  }

  function patchStaff(id: string, payload: Record<string, unknown>) {
    return request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${id}`)
      .set(authHeader(adminToken))
      .send(payload);
  }

  it('creates staff, stores the normalized phone and returns the temporary PIN only once', async () => {
    const response = await postStaff(VALID_CREATE).expect(201);
    const temporaryPin = response.body.temporary_pin as string;

    expect(temporaryPin).toMatch(/^\d{6}$/);
    expect(response.body.staff).toMatchObject({
      staff_code: 'CASH001',
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: NORMALIZED_PHONE,
      name: 'Ada Okafor',
    });

    const stored = await context.prisma.staff.findUniqueOrThrow({
      where: { id: response.body.staff.id as string },
    });
    expect(stored.phone).toBe(NORMALIZED_PHONE);

    const list = await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(authHeader(adminToken))
      .expect(200);
    const detail = await request(context.app.getHttpServer())
      .get(`/api/v1/staff/${stored.id}`)
      .set(authHeader(adminToken))
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(temporaryPin);
    expect(JSON.stringify(detail.body)).not.toContain(temporaryPin);
    expect(detail.body).toMatchObject({
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: NORMALIZED_PHONE,
      name: 'Ada Okafor',
    });
  });

  it.each(['first_name', 'last_name', 'phone'])(
    'rejects create without %s',
    async (field) => {
      const payload: Record<string, unknown> = { ...VALID_CREATE };
      delete payload[field];

      await postStaff(payload).expect(400);
    },
  );

  it.each(['06031234567', '+447911123456', '0803123456', 'abc'])(
    'rejects create with invalid phone %j',
    async (phone) => {
      await postStaff({ ...VALID_CREATE, phone }).expect(400);
    },
  );

  it('rejects the read-only name field and other unknown fields on create', async () => {
    await postStaff({ ...VALID_CREATE, name: 'Ada Okafor' }).expect(400);
    await postStaff({ ...VALID_CREATE, nickname: 'Ada' }).expect(400);
  });

  it.each(PHONE_FORMATS)('stores the same normalized phone for %j', async (phone) => {
    const response = await postStaff({
      ...VALID_CREATE,
      staff_code: `NORM${String(PHONE_FORMATS.indexOf(phone) + 1).padStart(3, '0')}`,
      phone,
    }).expect(201);

    expect(response.body.staff.phone).toBe(NORMALIZED_PHONE);
    const stored = await context.prisma.staff.findUniqueOrThrow({
      where: { id: response.body.staff.id as string },
    });
    expect(stored.phone).toBe(NORMALIZED_PHONE);
  });

  it('rejects a duplicate staff code but allows the same phone on two staff', async () => {
    await postStaff(VALID_CREATE).expect(201);

    await postStaff({
      ...VALID_CREATE,
      first_name: 'Duplicate',
      phone: '08039999999',
    })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('staff_code_taken');
      });

    const second = await postStaff({
      ...VALID_CREATE,
      staff_code: 'CASH002',
      first_name: 'Second',
      last_name: 'Cashier',
    }).expect(201);

    expect(second.body.staff.phone).toBe(NORMALIZED_PHONE);
    expect(
      await context.prisma.staff.count({
        where: { store_id: storeId, phone: NORMALIZED_PHONE },
      }),
    ).toBe(2);
  });

  it('updates only the role', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    const response = await patchStaff(target.id, { role: 'manager' }).expect(
      200,
    );

    expect(response.body).toMatchObject({
      role: 'manager',
      first_name: target.first_name,
      last_name: target.last_name,
      phone: target.phone,
    });
  });

  it('updates only the phone and re-normalizes it', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
      phone: '+2348031111111',
    });

    const response = await patchStaff(target.id, {
      phone: '0803 222 2222',
    }).expect(200);

    expect(response.body.phone).toBe('+2348032222222');
    const stored = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(stored.phone).toBe('+2348032222222');
  });

  it('updates only the first name', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    const response = await patchStaff(target.id, {
      first_name: '  Adaeze  ',
    }).expect(200);

    expect(response.body.first_name).toBe('Adaeze');
    expect(response.body.last_name).toBe(target.last_name);
    expect(response.body.name).toBe(`Adaeze ${target.last_name}`);
  });

  it('updates only the last name', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    const response = await patchStaff(target.id, {
      last_name: '  Nwosu  ',
    }).expect(200);

    expect(response.body.last_name).toBe('Nwosu');
    expect(response.body.first_name).toBe(target.first_name);
    expect(response.body.name).toBe(`${target.first_name} Nwosu`);
  });

  it('updates all profile fields and the role together', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    const response = await patchStaff(target.id, {
      first_name: 'Chika',
      last_name: 'Eze',
      phone: '08111234567',
      role: 'manager',
    }).expect(200);

    expect(response.body).toMatchObject({
      first_name: 'Chika',
      last_name: 'Eze',
      phone: '+2348111234567',
      name: 'Chika Eze',
      role: 'manager',
      must_change_pin: true,
    });
  });

  it('returns the current record for an empty body without writing or auditing', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });
    const auditCount = await context.prisma.auditLog.count({
      where: { entity_id: target.id },
    });

    const response = await patchStaff(target.id, {}).expect(200);

    expect(response.body).toMatchObject({
      id: target.id,
      first_name: target.first_name,
      last_name: target.last_name,
      phone: target.phone,
      role: target.role,
    });
    const stored = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(stored.updated_at).toEqual(target.updated_at);
    expect(
      await context.prisma.auditLog.count({ where: { entity_id: target.id } }),
    ).toBe(auditCount);
  });

  it('treats unchanged values as a no-op without writing or auditing', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });
    const auditCount = await context.prisma.auditLog.count({
      where: { entity_id: target.id },
    });

    await patchStaff(target.id, {
      first_name: target.first_name,
      last_name: target.last_name,
      phone: target.phone,
      role: target.role,
    }).expect(200);

    const stored = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(stored.updated_at).toEqual(target.updated_at);
    expect(
      await context.prisma.auditLog.count({ where: { entity_id: target.id } }),
    ).toBe(auditCount);
  });

  it('rejects name, invalid phone and empty names on update', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    await patchStaff(target.id, { name: 'Renamed' }).expect(400);
    await patchStaff(target.id, { phone: '06031234567' }).expect(400);
    await patchStaff(target.id, { first_name: '   ' }).expect(400);
  });

  it('allows only admins to update staff', async () => {
    const manager = await createStaffFixture(context, storeId, {
      staff_code: 'MGR001',
      role: 'manager',
    });
    const cashier = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
      role: 'cashier',
    });
    const managerToken = (await loginAs(context, 'MGR001')).token;
    const cashierToken = (await loginAs(context, 'CASH001')).token;

    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${cashier.id}`)
      .set(authHeader(managerToken))
      .send({ first_name: 'Manager Edit' })
      .expect(403);
    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${cashier.id}`)
      .set(authHeader(cashierToken))
      .send({ first_name: 'Cashier Edit' })
      .expect(403);
    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${cashier.id}`)
      .set(authHeader(managerToken))
      .send({ role: 'admin' })
      .expect(403);

    expect(manager.role).toBe('manager');
  });

  it('keeps the last-admin protection and forces a PIN change on promotion', async () => {
    const admin = await context.prisma.staff.findFirstOrThrow({
      where: { staff_code: 'ADMIN001' },
    });
    const cashier = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });

    await patchStaff(admin.id, { role: 'manager' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('last_admin');
      });

    const promoted = await patchStaff(cashier.id, { role: 'admin' }).expect(
      200,
    );
    expect(promoted.body).toMatchObject({
      role: 'admin',
      must_change_pin: true,
    });
  });

  it('lists staff ordered by first name, last name and staff code', async () => {
    await createStaffFixture(context, storeId, {
      staff_code: 'C',
      first_name: 'Aaa',
      last_name: 'Zzz',
    });
    await createStaffFixture(context, storeId, {
      staff_code: 'ZZZ',
      first_name: 'Aaa',
      last_name: 'Aaa',
    });
    await createStaffFixture(context, storeId, {
      staff_code: 'AAA',
      first_name: 'Aaa',
      last_name: 'Aaa',
    });

    const response = await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(authHeader(adminToken))
      .expect(200);

    expect(
      response.body.map(
        (member: {
          first_name: string;
          last_name: string;
          staff_code: string;
        }) => `${member.first_name}|${member.last_name}|${member.staff_code}`,
      ),
    ).toEqual([
      'Aaa|Aaa|AAA',
      'Aaa|Aaa|ZZZ',
      'Aaa|Zzz|C',
      'Admin|Staff|ADMIN001',
    ]);
  });

  it('includes phone for manager and admin list and detail callers', async () => {
    await createStaffFixture(context, storeId, {
      staff_code: 'MGR001',
      role: 'manager',
    });
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
    });
    const managerToken = (await loginAs(context, 'MGR001')).token;

    const list = await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(authHeader(managerToken))
      .expect(200);
    const detail = await request(context.app.getHttpServer())
      .get(`/api/v1/staff/${target.id}`)
      .set(authHeader(managerToken))
      .expect(200);
    const adminDetail = await request(context.app.getHttpServer())
      .get(`/api/v1/staff/${target.id}`)
      .set(authHeader(adminToken))
      .expect(200);

    expect(list.body.find((member: { id: string }) => member.id === target.id))
      .toMatchObject({ phone: target.phone });
    expect(detail.body.phone).toBe(target.phone);
    expect(adminDetail.body.phone).toBe(target.phone);
  });

  it('records staff.updated audit rows for actual changes only', async () => {
    const target = await createStaffFixture(context, storeId, {
      staff_code: 'CASH001',
      phone: '+2348031111111',
    });

    await patchStaff(target.id, {
      first_name: target.first_name,
      last_name: 'Changed',
    }).expect(200);

    const audits = await context.prisma.auditLog.findMany({
      where: {
        entity_id: target.id,
        action: AUDIT_ACTIONS.staffUpdated,
      },
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({ fields: ['last_name'] });
  });
});
