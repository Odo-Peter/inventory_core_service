import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
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

describe('Authentication (e2e)', () => {
  let context: TestContext;
  let storeId: string;

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
      first_name: 'Admin',
      last_name: 'Staff',
      role: 'admin',
    });
  });

  it('returns the login response shape', async () => {
    const response = await login(context.app, 'ADMIN001').expect(200);

    expect(response.body).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3_600,
      staff: {
        name: 'Admin',
        role: 'admin',
        store_id: storeId,
        must_change_pin: false,
      },
    });
    expect(response.body.access_token).toBeTypeOf('string');
    expect(response.body.staff.id).toBeTypeOf('string');
    expectNoSecrets(response.body);
  });

  it('returns identical responses for an unknown code and a wrong PIN', async () => {
    await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    const unknown = await login(context.app, 'MISSING', '246810').expect(401);
    const wrongPin = await login(context.app, 'CASH001', '135790').expect(401);

    expect(unknown.body).toEqual(wrongPin.body);
    expect(unknown.body.code).toBe('invalid_credentials');
  });

  it('commits failed-login audit rows even though the request fails', async () => {
    await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    await login(context.app, 'CASH001', '135790').expect(401);
    await login(context.app, 'MISSING', '246810').expect(401);

    const audits = await context.prisma.auditLog.findMany({
      where: { store_id: storeId, action: AUDIT_ACTIONS.loginFailed },
      orderBy: { created_at: 'asc' },
    });

    expect(audits).toHaveLength(2);
    expect(audits[0]?.staff_id).not.toBeNull();
    expect(audits[1]?.staff_id).toBeNull();
  });

  it('locks at the threshold and escalates the duration', async () => {
    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(context.app, 'CASH001', '135790').expect(401);
    }

    let staff = await context.prisma.staff.findUniqueOrThrow({
      where: { id: cashier.id },
    });
    expect(staff.failed_pin_attempts).toBe(5);
    expect(staff.locked_until?.getTime()).toBe(
      context.clock.now().getTime() + 5 * 60_000,
    );

    const locked = await login(context.app, 'CASH001').expect(423);
    expect(locked.body.code).toBe('account_locked');
    expect(locked.headers['retry-after']).toBeDefined();

    context.clock.advanceMs(5 * 60_000 + 1_000);
    for (let attempt = 6; attempt <= 9; attempt += 1) {
      await login(context.app, 'CASH001', '135790').expect(401);
      staff = await context.prisma.staff.findUniqueOrThrow({
        where: { id: cashier.id },
      });
      expect(staff.failed_pin_attempts).toBe(attempt);
      expect(staff.locked_until?.getTime()).toBe(
        context.clock.now().getTime() + 5 * 60_000,
      );
      context.clock.advanceMs(5 * 60_000 + 1_000);
    }

    await login(context.app, 'CASH001', '135790').expect(401);
    staff = await context.prisma.staff.findUniqueOrThrow({
      where: { id: cashier.id },
    });
    expect(staff.failed_pin_attempts).toBe(10);
    expect(staff.locked_until?.getTime()).toBe(
      context.clock.now().getTime() + 15 * 60_000,
    );

    context.clock.advanceMs(15 * 60_000 + 1_000);
    for (let attempt = 11; attempt <= 14; attempt += 1) {
      await login(context.app, 'CASH001', '135790').expect(401);
      staff = await context.prisma.staff.findUniqueOrThrow({
        where: { id: cashier.id },
      });
      expect(staff.failed_pin_attempts).toBe(attempt);
      expect(staff.locked_until?.getTime()).toBe(
        context.clock.now().getTime() + 15 * 60_000,
      );
      context.clock.advanceMs(15 * 60_000 + 1_000);
    }

    await login(context.app, 'CASH001', '135790').expect(401);
    staff = await context.prisma.staff.findUniqueOrThrow({
      where: { id: cashier.id },
    });
    expect(staff.failed_pin_attempts).toBe(15);
    expect(staff.locked_until?.getTime()).toBe(
      context.clock.now().getTime() + 60 * 60_000,
    );

    const lastLockAudit = await context.prisma.auditLog.findFirst({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.accountLocked,
      },
      orderBy: { created_at: 'desc' },
    });
    expect(lastLockAudit?.details).toMatchObject({ tier: 2 });
  });

  it('rejects the correct PIN while an account is locked', async () => {
    await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(context.app, 'CASH001', '135790').expect(401);
    }

    await login(context.app, 'CASH001').expect(423);
  });

  it('increments exactly once for 10 parallel wrong PINs', async () => {
    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => login(context.app, 'CASH001', '135790')),
    );

    expect(responses.every((response) => response.status === 401)).toBe(true);

    const staff = await context.prisma.staff.findUniqueOrThrow({
      where: { id: cashier.id },
    });
    expect(staff.failed_pin_attempts).toBe(10);
  });

  it('invalidates the token on logout', async () => {
    const { token } = await loginAs(context, 'ADMIN001');

    await request(context.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(bearer(token))
      .expect(200);

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);

    const audit = await context.prisma.auditLog.findFirst({
      where: { store_id: storeId, action: AUDIT_ACTIONS.logout },
    });
    expect(audit).not.toBeNull();
  });

  it('changes the PIN and returns a working new token', async () => {
    const { token } = await loginAs(context, 'ADMIN001');

    const response = await request(context.app.getHttpServer())
      .post('/api/v1/auth/change-pin')
      .set(bearer(token))
      .send({ current_pin: '246810', new_pin: '135791' })
      .expect(200);

    expectNoSecrets(response.body);
    const newToken = response.body.access_token as string;
    expect(newToken).not.toBe(token);

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);
    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(newToken))
      .expect(200);

    await login(context.app, 'ADMIN001', '246810').expect(401);
    await login(context.app, 'ADMIN001', '135791').expect(200);
  });

  it('allows only change-pin and logout while a PIN change is required', async () => {
    await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
      mustChangePin: true,
    });

    const loginResponse = await login(context.app, 'CASH001').expect(200);
    expect(loginResponse.body.staff.must_change_pin).toBe(true);
    const token = loginResponse.body.access_token as string;

    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/staff',
      '/api/v1/shifts/current',
    ]) {
      const response = await request(context.app.getHttpServer())
        .get(path)
        .set(bearer(token))
        .expect(403);
      expect(response.body.code).toBe('pin_change_required');
    }

    await request(context.app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(bearer(token))
      .expect(200);

    const secondLogin = await login(context.app, 'CASH001').expect(200);
    const secondToken = secondLogin.body.access_token as string;

    await request(context.app.getHttpServer())
      .post('/api/v1/auth/change-pin')
      .set(bearer(secondToken))
      .send({ current_pin: '246810', new_pin: '135791' })
      .expect(200);
  });

  it('rejects a deactivated staff token on the next request', async () => {
    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASH001',
      role: 'cashier',
    });
    const { token } = await loginAs(context, 'CASH001');

    await context.prisma.staff.update({
      where: { id: cashier.id },
      data: { active: false },
    });

    await request(context.app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);
  });

  it('applies role changes immediately from the database', async () => {
    const manager = await createStaff(context, storeId, {
      staffCode: 'MGR001',
      role: 'manager',
    });
    const { token } = await loginAs(context, 'MGR001');

    await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(bearer(token))
      .expect(200);

    await context.prisma.staff.update({
      where: { id: manager.id },
      data: { role: 'cashier' },
    });

    await request(context.app.getHttpServer())
      .get('/api/v1/staff')
      .set(bearer(token))
      .expect(403);
  });

  it('requires exactly one active store for login', async () => {
    await context.prisma.store.update({
      where: { id: storeId },
      data: { active: false },
    });

    const response = await login(context.app, 'ADMIN001').expect(500);
    expect(response.body.code).toBe('configuration_error');
  });

  it('rejects login when more than one store is active', async () => {
    await createStore(context.prisma, { name: 'Second Store' });

    const response = await login(context.app, 'ADMIN001').expect(500);
    expect(response.body.code).toBe('configuration_error');
  });

  it('throttles login by IP', async () => {
    const throttled = await createTestApp({
      loginThrottleIpPerMin: 2,
      loginThrottleCodePerMin: 10_000,
    });

    try {
      await throttled.prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "AuditLog", "Shift", "Staff", "Store" CASCADE',
      );
      await createStore(throttled.prisma);

      await login(throttled.app, 'ONE', '246810').expect(401);
      await login(throttled.app, 'TWO', '246810').expect(401);
      await login(throttled.app, 'THREE', '246810').expect(429);
    } finally {
      await throttled.app.close();
    }
  });

  it('throttles login by staff code', async () => {
    const throttled = await createTestApp({
      loginThrottleIpPerMin: 10_000,
      loginThrottleCodePerMin: 2,
    });

    try {
      await throttled.prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "AuditLog", "Shift", "Staff", "Store" CASCADE',
      );
      const store = await createStore(throttled.prisma);
      await createStaff(
        { prisma: throttled.prisma, pinHasher: throttled.pinHasher },
        store.id,
        { staffCode: 'CASH001', role: 'cashier' },
      );

      await login(throttled.app, 'CASH001', '135790').expect(401);
      await login(throttled.app, 'CASH001', '135790').expect(401);
      await login(throttled.app, 'CASH001', '135790').expect(429);
    } finally {
      await throttled.app.close();
    }
  });
});
