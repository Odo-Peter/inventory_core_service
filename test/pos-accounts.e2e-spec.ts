import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '../src/generated/prisma/enums.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

describe('POS accounts (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let tokens: Record<StaffRole, string>;
  let managerId: string;

  const server = () => context.app.getHttpServer();

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma)).id;

    for (const role of ['cashier', 'manager', 'admin'] as StaffRole[]) {
      await createStaff(context, storeId, {
        staffCode: role.toUpperCase(),
        role,
      });
    }
    tokens = {
      cashier: (await loginAs(context, 'CASHIER')).token,
      manager: (await loginAs(context, 'MANAGER')).token,
      admin: (await loginAs(context, 'ADMIN')).token,
    };
    managerId = (await loginAs(context, 'MANAGER')).staffId;
  });

  function createAccount(
    overrides: Record<string, unknown> = {},
    token = tokens.manager,
  ) {
    return request(server())
      .post('/api/v1/pos-accounts')
      .set(bearer(token))
      .send({
        label: 'Front Counter POS',
        type: 'pos_terminal',
        details: 'Counter terminal 1',
        ...overrides,
      });
  }

  it('lets cashiers read and restricts setup to managers and admins', async () => {
    const account = await createAccount().expect(201);
    expect(account.body).toMatchObject({
      label: 'Front Counter POS',
      type: 'pos_terminal',
      details: 'Counter terminal 1',
      active: true,
      created_by_staff_id: managerId,
      store_id: storeId,
    });

    await request(server())
      .get('/api/v1/pos-accounts')
      .set(bearer(tokens.cashier))
      .expect(200);
    await request(server())
      .get(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.cashier))
      .expect(200);

    await createAccount({}, tokens.cashier).expect(403);
    await request(server())
      .patch(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.cashier))
      .send({ label: 'Nope' })
      .expect(403);
    await request(server())
      .post(`/api/v1/pos-accounts/${account.body.id}/deactivate`)
      .set(bearer(tokens.cashier))
      .expect(403);

    await createAccount({ label: 'Admin account' }, tokens.admin).expect(201);
  });

  it('normalizes labels and rejects full card or account numbers', async () => {
    const normalized = await createAccount({ label: '  Front   Counter  ' })
      .expect(201);
    expect(normalized.body.label).toBe('Front Counter');

    for (const details of [
      '012345678901',
      '0123 4567 8901',
      '0123-4567-8901',
      'acct 012345678901234',
    ]) {
      await createAccount({ details })
        .expect(400)
        .expect((res) => {
          expect(res.body.code).toBe('unsafe_pos_account_details');
        });
    }

    await createAccount({ details: 'GTBank ending 4821' }).expect(201);
    await createAccount({ details: null }).expect(201);
  });

  it('updates fields and writes an audit entry only for changes', async () => {
    const account = await createAccount().expect(201);

    const updated = await request(server())
      .patch(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.manager))
      .send({
        label: 'Main Bank',
        type: 'bank_account',
        details: 'GTBank ending 4821',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      label: 'Main Bank',
      type: 'bank_account',
      details: 'GTBank ending 4821',
    });

    const audits = await context.prisma.auditLog.findMany({
      where: {
        action: 'pos_account.updated',
        entity_id: account.body.id,
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ staff_id: managerId });
    expect(audits[0].details).toMatchObject({
      label_from: 'Front Counter POS',
      label_to: 'Main Bank',
      type_from: 'pos_terminal',
      type_to: 'bank_account',
    });

    await request(server())
      .patch(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.manager))
      .send({ label: 'Main Bank' })
      .expect(200);
    expect(
      await context.prisma.auditLog.count({
        where: {
          action: 'pos_account.updated',
          entity_id: account.body.id,
        },
      }),
    ).toBe(1);

    await request(server())
      .patch(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.manager))
      .send({ details: '012345678901' })
      .expect(400);
  });

  it('deactivates instead of deleting and is idempotent', async () => {
    const account = await createAccount().expect(201);

    const deactivated = await request(server())
      .post(`/api/v1/pos-accounts/${account.body.id}/deactivate`)
      .set(bearer(tokens.manager))
      .expect(200);
    expect(deactivated.body.active).toBe(false);

    await request(server())
      .post(`/api/v1/pos-accounts/${account.body.id}/deactivate`)
      .set(bearer(tokens.manager))
      .expect(200);

    expect(
      await context.prisma.auditLog.count({
        where: {
          action: 'pos_account.deactivated',
          entity_id: account.body.id,
        },
      }),
    ).toBe(1);

    await request(server())
      .delete(`/api/v1/pos-accounts/${account.body.id}`)
      .set(bearer(tokens.admin))
      .expect(404);

    const activeOnly = await request(server())
      .get('/api/v1/pos-accounts?active=true')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(activeOnly.body.data).toHaveLength(0);
  });

  it('filters by type and scopes every lookup to the store', async () => {
    await createAccount().expect(201);
    await createAccount({
      label: 'Bank',
      type: 'bank_account',
      details: 'Bank account ending 1234',
    }).expect(201);

    const banks = await request(server())
      .get('/api/v1/pos-accounts?type=bank_account')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(banks.body.data.map((row: { label: string }) => row.label)).toEqual([
      'Bank',
    ]);

    const otherStoreId = (
      await createStore(context.prisma, { name: 'Other' })
    ).id;
    const other = await context.prisma.pOSAccount.create({
      data: {
        store_id: otherStoreId,
        label: 'Other store',
        type: 'pos_terminal',
      },
    });

    await request(server())
      .get(`/api/v1/pos-accounts/${other.id}`)
      .set(bearer(tokens.admin))
      .expect(404);
    await request(server())
      .patch(`/api/v1/pos-accounts/${other.id}`)
      .set(bearer(tokens.manager))
      .send({ label: 'Nope' })
      .expect(404);
    await request(server())
      .post(`/api/v1/pos-accounts/${other.id}/deactivate`)
      .set(bearer(tokens.manager))
      .expect(404);
  });
});
