import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
import { maskPhone } from '../src/modules/users/phone.js';
import {
  authHeader,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const TEN_DIGITS = /\d{10}/;

describe('Staff audit trail (e2e)', () => {
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
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma)).id;
    await createStaff(context, storeId, {
      staff_code: 'ADMIN001',
      role: 'admin',
    });
    adminToken = (await loginAs(context, 'ADMIN001')).token;
  });

  it('records staff.created with masked profile details and no full phone or PIN', async () => {
    const phone = '08031234567';
    const response = await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(authHeader(adminToken))
      .send({
        staff_code: 'CASH001',
        first_name: 'Ada',
        last_name: 'Okafor',
        phone,
        role: 'cashier',
      })
      .expect(201);

    const audit = await context.prisma.auditLog.findFirstOrThrow({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffCreated,
        entity_id: response.body.staff.id as string,
      },
    });

    expect(audit.details).toMatchObject({
      staff_code: 'CASH001',
      role: 'cashier',
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: maskPhone('+2348031234567'),
    });

    const serialized = JSON.stringify(audit.details);
    expect(serialized).not.toContain('+2348031234567');
    expect(serialized).not.toMatch(TEN_DIGITS);
    expect(serialized).not.toContain(response.body.temporary_pin as string);
  });

  it('records staff.updated with changed fields and masked phone transitions', async () => {
    const target = await createStaff(context, storeId, {
      staff_code: 'CASH001',
      phone: '+2348031234567',
    });

    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${target.id}`)
      .set(authHeader(adminToken))
      .send({
        first_name: 'Adaeze',
        phone: '0803 555 5555',
      })
      .expect(200);

    const audits = await context.prisma.auditLog.findMany({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffUpdated,
        entity_id: target.id,
      },
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({
      fields: ['first_name', 'phone'],
      phone_from: maskPhone('+2348031234567'),
      phone_to: maskPhone('+2348035555555'),
    });

    const serialized = JSON.stringify(audits[0]?.details);
    expect(serialized).not.toContain('+2348031234567');
    expect(serialized).not.toContain('+2348035555555');
    expect(serialized).not.toMatch(TEN_DIGITS);
    expect(serialized).toContain(maskPhone('+2348031234567'));
    expect(serialized).toContain(maskPhone('+2348035555555'));
  });

  it('lists only the profile fields that actually changed', async () => {
    const target = await createStaff(context, storeId, {
      staff_code: 'CASH001',
    });

    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${target.id}`)
      .set(authHeader(adminToken))
      .send({
        first_name: target.first_name,
        last_name: 'Nwosu',
        phone: target.phone,
        role: target.role,
      })
      .expect(200);

    const audit = await context.prisma.auditLog.findFirstOrThrow({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.staffUpdated,
        entity_id: target.id,
      },
    });

    expect(audit.details).toMatchObject({ fields: ['last_name'] });
    expect(audit.details).not.toHaveProperty('phone_from');
    expect(audit.details).not.toHaveProperty('phone_to');
  });
});
