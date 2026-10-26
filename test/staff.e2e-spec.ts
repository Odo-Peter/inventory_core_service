import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
import { generateStaffCode } from '../src/modules/users/staff-code.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  expectNoSecrets,
  login,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

describe('Staff management (e2e)', () => {
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
    await createStaff(context, storeId, {
      staffCode: 'ADMIN001',
      role: 'admin',
    });
    adminToken = (await loginAs(context, 'ADMIN001')).token;
  });

  it('creates staff with a generated code and a temporary PIN that forces a PIN change', async () => {
    const response = await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(adminToken))
      .send({
        first_name: 'Cashier',
        last_name: 'One',
        phone: '08031234567',
        role: 'cashier',
      })
      .expect(201);

    expectNoSecrets(response.body);
    expect(response.body.temporary_pin).toMatch(/^\d{6}$/);
    expect(response.body.staff).toMatchObject({
      staff_code: 'TECSH001',
      role: 'cashier',
      must_change_pin: true,
      active: true,
    });

    const loginResponse = await login(
      context.app,
      response.body.staff.staff_code,
      response.body.temporary_pin,
    ).expect(200);
    expect(loginResponse.body.staff.must_change_pin).toBe(true);

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffCreated,
        entity_id: response.body.staff.id,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).not.toHaveProperty('pin');
    expect(audit?.details).not.toHaveProperty('temporary_pin');
  });

  it.each([
    ['cashier', 'TECSH001'],
    ['manager', 'TEMGR001'],
    ['admin', 'TEADM001'],
  ] as const)(
    'generates a %s code with the store and role prefixes',
    async (role, expectedCode) => {
      const response = await request(context.app.getHttpServer())
        .post('/api/v1/staff')
        .set(bearer(adminToken))
        .send({
          first_name: 'Prefix',
          last_name: role,
          phone: '08031234567',
          role,
        })
        .expect(201);

      expect(response.body.staff.staff_code).toBe(expectedCode);
    },
  );

  it('defaults to a cashier code when the role is omitted', async () => {
    const response = await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(adminToken))
      .send({
        first_name: 'Default',
        last_name: 'Role',
        phone: '08031234567',
      })
      .expect(201);

    expect(response.body.staff).toMatchObject({
      staff_code: 'TECSH001',
      role: 'cashier',
    });
  });

  it('increments codes independently for each role and store', async () => {
    const create = (role: string, token = adminToken) =>
      request(context.app.getHttpServer())
        .post('/api/v1/staff')
        .set(bearer(token))
        .send({
          first_name: 'Generated',
          last_name: role,
          phone: '08031234567',
          role,
        })
        .expect(201);

    const firstCashier = await create('cashier');
    const secondCashier = await create('cashier');
    const firstManager = await create('manager');

    expect(firstCashier.body.staff.staff_code).toBe('TECSH001');
    expect(secondCashier.body.staff.staff_code).toBe('TECSH002');
    expect(firstManager.body.staff.staff_code).toBe('TEMGR001');

    const otherStore = await createStore(context.prisma, {
      name: 'Second Store',
      active: false,
    });
    const otherStoreCode = await context.prisma.$transaction((tx) =>
      generateStaffCode(tx, otherStore.id, 'cashier'),
    );

    expect(otherStoreCode).toBe('SECSH001');
  });

  it('sanitizes the store prefix when the name has fewer than two letters', async () => {
    await context.prisma.store.update({
      where: { id: storeId },
      data: { name: '123' },
    });

    const response = await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(adminToken))
      .send({
        first_name: 'Numeric',
        last_name: 'Store',
        phone: '08031234567',
        role: 'cashier',
      })
      .expect(201);

    expect(response.body.staff.staff_code).toBe('XXCSH001');
  });

  it('does not reuse codes left in lower gaps after staff are removed', async () => {
    const removed = await createStaff(context, storeId, {
      staffCode: 'TECSH001',
      role: 'cashier',
    });
    await createStaff(context, storeId, {
      staffCode: 'TECSH002',
      role: 'cashier',
    });
    await context.prisma.staff.delete({ where: { id: removed.id } });

    const response = await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(adminToken))
      .send({
        first_name: 'After',
        last_name: 'Removal',
        phone: '08031234567',
        role: 'cashier',
      })
      .expect(201);

    expect(response.body.staff.staff_code).toBe('TECSH003');
  });

  it('rejects a client-supplied staff code on create', async () => {
    await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(adminToken))
      .send({
        staff_code: 'CASH001',
        first_name: 'Client',
        last_name: 'Code',
        phone: '08031234567',
      })
      .expect(400);

    expect(
      await context.prisma.staff.count({
        where: { store_id: storeId, staff_code: 'CASH001' },
      }),
    ).toBe(0);
  });

  it('lists staff without secrets and computes lock status', async () => {
    const locked = await createStaff(context, storeId, {
      staffCode: 'LOCKED',
      role: 'cashier',
    });
    await context.prisma.staff.update({
      where: { id: locked.id },
      data: {
        failed_pin_attempts: 5,
        locked_until: new Date('2026-10-25T12:05:00.000Z'),
      },
    });

    const response = await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(bearer(adminToken))
      .expect(200);

    expectNoSecrets(response.body);
    const lockedResponse = response.body.find(
      (member: { staff_code: string }) => member.staff_code === 'LOCKED',
    );
    expect(lockedResponse.is_locked).toBe(true);
  });

  it('updates names and roles with audit entries', async () => {
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    const response = await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${target.id}`)
      .set(bearer(adminToken))
      .send({
        first_name: 'Renamed',
        last_name: 'Cashier',
        role: 'manager',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      first_name: 'Renamed',
      last_name: 'Cashier',
      name: 'Renamed Cashier',
      role: 'manager',
    });

    const audits = await context.prisma.auditLog.findMany({
      where: {
        store_id: storeId,
        entity_id: target.id,
        action: {
          in: [AUDIT_ACTIONS.staffUpdated, AUDIT_ACTIONS.staffRoleChanged],
        },
      },
      orderBy: { created_at: 'asc' },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      AUDIT_ACTIONS.staffUpdated,
      AUDIT_ACTIONS.staffRoleChanged,
    ]);
  });

  it('forces a PIN change when promoting a cashier to a privileged role', async () => {
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });
    const { token } = await loginAs(context, 'CASH001');

    const response = await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${target.id}`)
      .set(bearer(adminToken))
      .send({ role: 'manager' })
      .expect(200);

    expect(response.body).toMatchObject({
      role: 'manager',
      must_change_pin: true,
    });

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(403)
      .expect((errorResponse) => {
        expect(errorResponse.body.code).toBe('pin_change_required');
      });

    await request(context.app.getHttpServer())
      .post('/api/v1/auth/change-pin')
      .set(bearer(token))
      .send({ current_pin: '246810', new_pin: '135791' })
      .expect(200);
  });

  it('blocks deactivation while the staff member has an open shift', async () => {
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });
    const { token } = await loginAs(context, 'CASH001');

    const shift = await context.prisma.shift.create({
      data: {
        store_id: storeId,
        staff_id: target.id,
        clock_in_at: new Date('2026-10-25T11:00:00.000Z'),
      },
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/deactivate`)
      .set(bearer(adminToken))
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('staff_has_open_shift');
      });

    await context.prisma.shift.delete({ where: { id: shift.id } });

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/deactivate`)
      .set(bearer(adminToken))
      .expect(200);

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffDeactivated,
        entity_id: target.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('reactivates staff without restoring old tokens', async () => {
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
      active: false,
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/reactivate`)
      .set(bearer(adminToken))
      .expect(200)
      .expect((response) => {
        expect(response.body.active).toBe(true);
      });

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffReactivated,
        entity_id: target.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('resets a cashier PIN with the manager acting PIN', async () => {
    await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    const managerToken = (await loginAs(context, 'MGR001')).token;
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });
    const { token: targetToken } = await loginAs(context, 'CASH001');

    await context.prisma.staff.update({
      where: { id: target.id },
      data: {
        failed_pin_attempts: 4,
        locked_until: new Date('2026-10-25T12:10:00.000Z'),
      },
    });

    const before = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });

    const response = await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/reset-pin`)
      .set(bearer(managerToken))
      .send({ acting_pin: '246810' })
      .expect(200);

    expectNoSecrets(response.body);
    expect(response.body.staff.must_change_pin).toBe(true);
    expect(response.body.temporary_pin).toMatch(/^\d{6}$/);

    const after = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.failed_pin_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
    expect(after.token_version).toBe(before.token_version + 1);

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(targetToken))
      .expect(401);

    await login(context.app, 'CASH001', response.body.temporary_pin).expect(
      200,
    );

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.pinReset,
        entity_id: target.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an invalid acting PIN and audits the failure', async () => {
    await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    const managerToken = (await loginAs(context, 'MGR001')).token;
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/reset-pin`)
      .set(bearer(managerToken))
      .send({ acting_pin: '135790' })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('invalid_credentials');
      });

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        staff_id: (
          await context.prisma.staff.findFirstOrThrow({
            where: { staff_code: 'MGR001' },
          })
        ).id,
        action: AUDIT_ACTIONS.loginFailed,
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.details).toMatchObject({ reason: 'acting_pin' });
  });

  it('unlocks staff and clears lockout state', async () => {
    await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    const managerToken = (await loginAs(context, 'MGR001')).token;
    const target = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    await context.prisma.staff.update({
      where: { id: target.id },
      data: {
        failed_pin_attempts: 5,
        locked_until: new Date('2026-10-25T12:10:00.000Z'),
      },
    });

    const before = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });

    const response = await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${target.id}/unlock`)
      .set(bearer(managerToken))
      .send({ acting_pin: '246810' })
      .expect(200);

    expect(response.body.is_locked).toBe(false);

    const after = await context.prisma.staff.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.failed_pin_attempts).toBe(0);
    expect(after.locked_until).toBeNull();
    expect(after.token_version).toBe(before.token_version + 1);

    const audit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.unlocked,
        entity_id: target.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it('scopes staff lookups to the current store', async () => {
    const otherStore = await createStore(context.prisma, {
      name: 'Other Store',
      active: false,
    });
    const foreignStaff = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
      role: 'cashier',
    });

    await request(context.app.getHttpServer())
      .get(`/api/v1/staff/${foreignStaff.id}`)
      .set(bearer(adminToken))
      .expect(404);

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${foreignStaff.id}/deactivate`)
      .set(bearer(adminToken))
      .expect(404);
  });
});
