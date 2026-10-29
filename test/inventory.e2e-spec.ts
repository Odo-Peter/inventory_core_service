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

describe('Inventory (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let tokens: Record<StaffRole, string>;
  let managerId: string;
  let itemSequence = 0;

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

  async function createItem(
    overrides: Partial<{
      storeId: string;
      sku: string;
      name: string;
      active: boolean;
      stock: number;
    }> = {},
  ) {
    itemSequence += 1;
    return context.prisma.item.create({
      data: {
        store_id: overrides.storeId ?? storeId,
        sku: overrides.sku ?? `STOCK-${itemSequence}`,
        name: overrides.name ?? `Stock item ${itemSequence}`,
        unit: 'piece',
        current_price: 1000,
        cost_price: 600,
        reorder_threshold: 2,
        active: overrides.active ?? true,
        stock_quantity: overrides.stock ?? 0,
      },
    });
  }

  function postStock(
    itemId: string,
    action: 'initial' | 'receive' | 'adjust' | 'damage',
    body: Record<string, unknown>,
    token = tokens.manager,
  ) {
    return request(server())
      .post(`/api/v1/inventory/items/${itemId}/${action}`)
      .set(bearer(token))
      .send(body);
  }

  it('restricts stock writes to managers and above', async () => {
    const item = await createItem();

    for (const action of ['initial', 'receive', 'adjust', 'damage'] as const) {
      await postStock(item.id, action, { quantity: 1, quantity_change: 1 }, tokens.cashier)
        .expect(403);
    }

    await request(server())
      .get(`/api/v1/inventory/items/${item.id}/movements`)
      .set(bearer(tokens.cashier))
      .expect(403);

    await postStock(item.id, 'initial', { quantity: 3 }).expect(201);
    await postStock(item.id, 'receive', { quantity: 2 }).expect(201);
  });

  it('records opening stock once and rejects a second initial movement', async () => {
    const item = await createItem();

    const response = await postStock(item.id, 'initial', {
      quantity: 10,
      note: 'Opening count',
    }).expect(201);

    expect(response.body).toMatchObject({
      item_id: item.id,
      quantity_change: 10,
      reason: 'initial',
      staff_id: managerId,
      note: 'Opening count',
    });

    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.stock_quantity).toBe(10);

    await postStock(item.id, 'initial', { quantity: 5 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('initial_stock_exists'));

    expect(
      await context.prisma.stockMovement.count({ where: { item_id: item.id } }),
    ).toBe(1);

    const audits = await context.prisma.auditLog.findMany({
      where: { action: 'stock.initialized', entity_id: item.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].staff_id).toBe(managerId);
    expect(audits[0].details).toMatchObject({ movement_id: response.body.id });
  });

  it('receives stock and records supplier details in audit only', async () => {
    const item = await createItem();
    await postStock(item.id, 'initial', { quantity: 1 }).expect(201);

    const response = await postStock(item.id, 'receive', {
      quantity: 7,
      supplier_name: ' Acme Beverages ',
      delivery_reference: ' DR-42 ',
    }).expect(201);
    expect(response.body.reason).toBe('restock');

    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.stock_quantity).toBe(8);

    const audit = await context.prisma.auditLog.findFirstOrThrow({
      where: { action: 'stock.received', entity_id: item.id },
    });
    expect(audit.details).toMatchObject({
      movement_id: response.body.id,
      supplier_name: 'Acme Beverages',
      delivery_reference: 'DR-42',
    });

    await postStock(item.id, 'receive', { quantity: 0 }).expect(400);
    await postStock(item.id, 'receive', { quantity: 1.5 }).expect(400);
  });

  it('applies signed adjustments and never allows negative stock', async () => {
    const item = await createItem();
    await postStock(item.id, 'initial', { quantity: 10 }).expect(201);

    await postStock(item.id, 'adjust', { quantity_change: 5 }).expect(200);
    await postStock(item.id, 'adjust', {
      quantity_change: -3,
      note: 'Count correction',
    }).expect(200);

    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).stock_quantity,
    ).toBe(12);

    await postStock(item.id, 'adjust', { quantity_change: 0 }).expect(400);

    const movementsBefore = await context.prisma.stockMovement.count({
      where: { item_id: item.id },
    });
    await postStock(item.id, 'adjust', { quantity_change: -13 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('insufficient_stock'));

    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).stock_quantity,
    ).toBe(12);
    expect(
      await context.prisma.stockMovement.count({ where: { item_id: item.id } }),
    ).toBe(movementsBefore);
  });

  it('records damage as a negative movement', async () => {
    const item = await createItem();
    await postStock(item.id, 'initial', { quantity: 5 }).expect(201);

    const response = await postStock(item.id, 'damage', {
      quantity: 2,
      note: 'Broken bottles',
    }).expect(201);
    expect(response.body).toMatchObject({
      quantity_change: -2,
      reason: 'damage',
      note: 'Broken bottles',
    });

    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).stock_quantity,
    ).toBe(3);

    await postStock(item.id, 'damage', { quantity: 4 }).expect(409);
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'stock.damaged', entity_id: item.id },
      }),
    ).toBe(1);
  });

  it('rejects initial and restock on inactive items but allows write-off', async () => {
    const inactive = await createItem({ active: false, stock: 4 });

    await postStock(inactive.id, 'initial', { quantity: 1 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('item_inactive'));
    await postStock(inactive.id, 'receive', { quantity: 1 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('item_inactive'));

    await postStock(inactive.id, 'adjust', { quantity_change: -1 }).expect(200);
    await postStock(inactive.id, 'damage', { quantity: 1 }).expect(201);

    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: inactive.id },
        })
      ).stock_quantity,
    ).toBe(2);
  });

  it('treats cross-store items as not found', async () => {
    const otherStoreId = (
      await createStore(context.prisma, { name: 'Other' })
    ).id;
    const otherItem = await createItem({ storeId: otherStoreId });

    await postStock(otherItem.id, 'initial', { quantity: 1 }).expect(404);
    await request(server())
      .get(`/api/v1/inventory/items/${otherItem.id}/movements`)
      .set(bearer(tokens.manager))
      .expect(404);
  });

  it('serializes concurrent decrements without overselling', async () => {
    const item = await createItem();
    await postStock(item.id, 'initial', { quantity: 10 }).expect(201);

    const results = await Promise.all([
      postStock(item.id, 'adjust', { quantity_change: -6 }),
      postStock(item.id, 'adjust', { quantity_change: -6 }),
    ]);

    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).stock_quantity,
    ).toBe(4);
    expect(
      await context.prisma.stockMovement.count({
        where: { item_id: item.id, reason: 'adjustment' },
      }),
    ).toBe(1);
  });

  it('lists an item movement history newest first with pagination', async () => {
    const item = await createItem();
    await postStock(item.id, 'initial', { quantity: 10 }).expect(201);
    await postStock(item.id, 'receive', { quantity: 2 }).expect(201);
    await postStock(item.id, 'damage', { quantity: 1 }).expect(201);

    const page1 = await request(server())
      .get(`/api/v1/inventory/items/${item.id}/movements?page=1&page_size=2`)
      .set(bearer(tokens.manager))
      .expect(200);
    const page2 = await request(server())
      .get(`/api/v1/inventory/items/${item.id}/movements?page=2&page_size=2`)
      .set(bearer(tokens.manager))
      .expect(200);

    expect(page1.body.data.map((m: { reason: string }) => m.reason)).toEqual([
      'damage',
      'restock',
    ]);
    expect(page2.body.data.map((m: { reason: string }) => m.reason)).toEqual([
      'initial',
    ]);
    expect(page1.body.meta).toMatchObject({ total: 3, page: 1, page_size: 2 });
  });

  it('reports only drifted items in reconciliation, to admins only', async () => {
    const healthy = await createItem({ sku: 'HEALTHY' });
    const drifted = await createItem({ sku: 'DRIFTED' });
    await postStock(healthy.id, 'initial', { quantity: 5 }).expect(201);
    await postStock(drifted.id, 'initial', { quantity: 5 }).expect(201);

    await context.prisma.item.update({
      where: { id: drifted.id },
      data: { stock_quantity: 9 },
    });

    const response = await request(server())
      .get('/api/v1/inventory/reconciliation')
      .set(bearer(tokens.admin))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      item_id: drifted.id,
      sku: 'DRIFTED',
      stock_quantity: 9,
      movement_total: 5,
      difference: 4,
    });
    expect(response.body.meta.total).toBe(1);

    await request(server())
      .get('/api/v1/inventory/reconciliation')
      .set(bearer(tokens.manager))
      .expect(403);
  });
});
