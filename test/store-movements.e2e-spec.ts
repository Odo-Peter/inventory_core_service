import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StockMovementReason } from '../src/generated/prisma/enums.js';
import { ItemUnit } from '../src/modules/catalog/item-unit.enum.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

interface SeededItem {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
}

describe('Store stock movements (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let otherStoreId: string;
  let managerToken: string;
  let cashierToken: string;
  let adminToken: string;
  let managerId: string;
  let cashierId: string;
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

    await createStaff(context, storeId, {
      staffCode: 'MGR-A',
      role: 'manager',
    });
    await createStaff(context, storeId, {
      staffCode: 'CASH-A',
      role: 'cashier',
    });
    await createStaff(context, storeId, {
      staffCode: 'ADMIN-A',
      role: 'admin',
    });

    // Login resolves the single active store, so authenticate before adding
    // the second store used for tenant-isolation assertions.
    const manager = await loginAs(context, 'MGR-A');
    managerToken = manager.token;
    managerId = manager.staffId;
    cashierToken = (await loginAs(context, 'CASH-A')).token;
    cashierId = (await loginAs(context, 'CASH-A')).staffId;
    adminToken = (await loginAs(context, 'ADMIN-A')).token;

    otherStoreId = (
      await createStore(context.prisma, { name: 'Other Store' })
    ).id;
  });

  async function createItem(
    itemStoreId: string,
    overrides: Partial<{
      name: string;
      sku: string;
      barcode: string | null;
    }> = {},
  ): Promise<SeededItem> {
    itemSequence += 1;
    return context.prisma.item.create({
      data: {
        store_id: itemStoreId,
        sku: overrides.sku ?? `ITEM-${itemSequence}`,
        name: overrides.name ?? `Item ${itemSequence}`,
        barcode: overrides.barcode ?? `BAR-${itemSequence}`,
        unit: ItemUnit.PIECE,
        current_price: 1_000,
      },
      select: { id: true, name: true, sku: true, barcode: true },
    });
  }

  function createMovement(input: {
    store: string;
    itemId: string;
    staffId: string | null;
    reason: StockMovementReason;
    quantityChange: number;
    createdAt: Date;
    note?: string | null;
  }) {
    return context.prisma.stockMovement.create({
      data: {
        store_id: input.store,
        item_id: input.itemId,
        staff_id: input.staffId,
        reason: input.reason,
        quantity_change: input.quantityChange,
        created_at: input.createdAt,
        note: input.note ?? null,
      },
    });
  }

  function listMovements(token: string, query = '') {
    return request(server())
      .get(`/api/v1/inventory/movements${query}`)
      .set(bearer(token));
  }

  it('returns only the own store, newest first, with display fields', async () => {
    const coke = await createItem(storeId, {
      name: 'Coca Cola',
      sku: 'COKE-001',
      barcode: '111111',
    });
    const fanta = await createItem(storeId, {
      name: 'Fanta',
      sku: 'FANTA-001',
      barcode: '222222',
    });
    const otherItem = await createItem(otherStoreId, { name: 'Other item' });

    const older = await createMovement({
      store: storeId,
      itemId: coke.id,
      staffId: managerId,
      reason: 'sale',
      quantityChange: -1,
      createdAt: new Date('2026-11-06T10:00:00.000Z'),
    });
    const newer = await createMovement({
      store: storeId,
      itemId: fanta.id,
      staffId: null,
      reason: 'restock',
      quantityChange: 5,
      createdAt: new Date('2026-11-06T11:00:00.000Z'),
    });
    await createMovement({
      store: otherStoreId,
      itemId: otherItem.id,
      staffId: null,
      reason: 'sale',
      quantityChange: -1,
      createdAt: new Date('2026-11-06T12:00:00.000Z'),
    });

    const response = await listMovements(managerToken).expect(200);

    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(response.body.meta).toMatchObject({
      page: 1,
      page_size: 25,
      total: 2,
    });
    expect(response.body.data[0]).toMatchObject({
      item_name: 'Fanta',
      item_sku: 'FANTA-001',
      staff_name: null,
    });
    expect(response.body.data[1]).toMatchObject({
      item_name: 'Coca Cola',
      item_sku: 'COKE-001',
      staff_name: 'Test Staff',
    });
  });

  it('filters by item, staff, reason and date range', async () => {
    const coke = await createItem(storeId, {
      name: 'Coca Cola',
      sku: 'COKE-001',
      barcode: '111111',
    });
    const fanta = await createItem(storeId, {
      name: 'Fanta',
      sku: 'FANTA-001',
      barcode: '222222',
    });

    const sale = await createMovement({
      store: storeId,
      itemId: coke.id,
      staffId: managerId,
      reason: 'sale',
      quantityChange: -1,
      createdAt: new Date('2026-11-06T10:00:00.000Z'),
    });
    const damage = await createMovement({
      store: storeId,
      itemId: fanta.id,
      staffId: cashierId,
      reason: 'damage',
      quantityChange: -2,
      createdAt: new Date('2026-11-06T11:00:00.000Z'),
    });

    const byItem = await listMovements(
      managerToken,
      `?item_id=${coke.id}`,
    ).expect(200);
    expect(byItem.body.data.map((row: { id: string }) => row.id)).toEqual([
      sale.id,
    ]);

    const byStaff = await listMovements(
      managerToken,
      `?staff_id=${cashierId}`,
    ).expect(200);
    expect(byStaff.body.data.map((row: { id: string }) => row.id)).toEqual([
      damage.id,
    ]);

    const byReason = await listMovements(
      managerToken,
      '?reason=sale,damage',
    ).expect(200);
    expect(byReason.body.data.map((row: { id: string }) => row.id)).toEqual([
      damage.id,
      sale.id,
    ]);

    const fromOnly = await listMovements(
      managerToken,
      '?from=2026-11-06T10:30:00.000Z',
    ).expect(200);
    expect(fromOnly.body.data.map((row: { id: string }) => row.id)).toEqual([
      damage.id,
    ]);

    const toOnly = await listMovements(
      managerToken,
      '?to=2026-11-06T10:30:00.000Z',
    ).expect(200);
    expect(toOnly.body.data.map((row: { id: string }) => row.id)).toEqual([
      sale.id,
    ]);

    const fromAndTo = await listMovements(
      managerToken,
      '?from=2026-11-06T10:00:00.000Z&to=2026-11-06T11:00:00.000Z',
    ).expect(200);
    expect(fromAndTo.body.data.map((row: { id: string }) => row.id)).toEqual([
      damage.id,
      sale.id,
    ]);

    const combined = await listMovements(
      managerToken,
      `?item_id=${coke.id}&reason=sale&from=2026-11-06T09:00:00.000Z&to=2026-11-06T11:00:00.000Z`,
    ).expect(200);
    expect(combined.body.data.map((row: { id: string }) => row.id)).toEqual([
      sale.id,
    ]);
  });

  it('searches item name, SKU and barcode case-insensitively', async () => {
    const coke = await createItem(storeId, {
      name: 'Coca Cola',
      sku: 'COKE-001',
      barcode: '111111',
    });
    await createMovement({
      store: storeId,
      itemId: coke.id,
      staffId: managerId,
      reason: 'sale',
      quantityChange: -1,
      createdAt: new Date('2026-11-06T10:00:00.000Z'),
    });

    for (const search of ['COCA', 'coke', '111']) {
      const response = await listMovements(
        managerToken,
        `?search=${search}`,
      ).expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        item_name: 'Coca Cola',
        item_sku: 'COKE-001',
      });
    }
  });

  it('rejects a from date after the to date', async () => {
    const response = await listMovements(
      managerToken,
      '?from=2026-11-07T00:00:00.000Z&to=2026-11-06T00:00:00.000Z',
    ).expect(400);

    expect(response.body.code).toBe('invalid_date_range');
  });

  it('paginates deterministically and returns an empty page', async () => {
    const item = await createItem(storeId);
    const movements = [];
    for (let index = 0; index < 3; index += 1) {
      movements.push(
        await createMovement({
          store: storeId,
          itemId: item.id,
          staffId: managerId,
          reason: 'adjustment',
          quantityChange: index + 1,
          createdAt: new Date(
            `2026-11-06T1${index}:00:00.000Z`,
          ),
        }),
      );
    }

    const page2 = await listMovements(
      managerToken,
      '?page=2&page_size=1',
    ).expect(200);

    expect(page2.body.data.map((row: { id: string }) => row.id)).toEqual([
      movements[1].id,
    ]);
    expect(page2.body.meta).toEqual({
      page: 2,
      page_size: 1,
      total: 3,
      total_pages: 3,
    });

    const empty = await listMovements(
      managerToken,
      '?page=1&page_size=10&search=no-such-item',
    ).expect(200);

    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta).toEqual({
      page: 1,
      page_size: 10,
      total: 0,
      total_pages: 0,
    });
  });

  it('does not collide with item movements or reconciliation, and enforces roles', async () => {
    const item = await createItem(storeId);
    const movement = await createMovement({
      store: storeId,
      itemId: item.id,
      staffId: managerId,
      reason: 'sale',
      quantityChange: -1,
      createdAt: new Date('2026-11-06T10:00:00.000Z'),
    });

    await listMovements(cashierToken).expect(403);
    await listMovements(managerToken).expect(200);

    const itemMovements = await request(server())
      .get(`/api/v1/inventory/items/${item.id}/movements`)
      .set(bearer(managerToken))
      .expect(200);
    expect(itemMovements.body.data.map((row: { id: string }) => row.id)).toEqual(
      [movement.id],
    );

    await request(server())
      .get('/api/v1/inventory/reconciliation')
      .set(bearer(managerToken))
      .expect(403);
    await request(server())
      .get('/api/v1/inventory/reconciliation')
      .set(bearer(adminToken))
      .expect(200);
  });
});
