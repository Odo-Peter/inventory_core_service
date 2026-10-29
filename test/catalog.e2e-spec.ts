import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '../src/generated/prisma/enums.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  imageBuffer,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';
import { MemoryImageStorage } from './helpers/image-storage.fake.js';

describe('Catalog (e2e)', () => {
  let context: TestContext;
  let storage: MemoryImageStorage;
  let storeId: string;
  let tokens: Record<StaffRole, string>;
  let adminId: string;

  const server = () => context.app.getHttpServer();

  beforeAll(async () => {
    storage = new MemoryImageStorage();
    context = await createTestApp({}, { imageStorage: storage });
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
    storage.objects.clear();
    storage.uploads.length = 0;
    storage.removals.length = 0;
    storage.failNextUpload = false;
    storage.failNextRemove = false;
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
    adminId = (await loginAs(context, 'ADMIN')).staffId;
  });

  async function createCategory(name: string, token = tokens.admin) {
    return request(server())
      .post('/api/v1/categories')
      .set(bearer(token))
      .send({ name })
      .expect(201);
  }

  async function createItem(
    overrides: Record<string, unknown> = {},
    token = tokens.admin,
  ) {
    return request(server())
      .post('/api/v1/items')
      .set(bearer(token))
      .send({
        name: overrides.name ?? 'Item',
        unit: overrides.unit ?? 'piece',
        current_price: overrides.current_price ?? 1000,
        ...overrides,
      })
      .expect(201);
  }

  it('enforces catalog roles', async () => {
    const category = await createCategory('Drinks');
    const item = await createItem({ category_id: category.body.id });

    await request(server())
      .get('/api/v1/items')
      .set(bearer(tokens.cashier))
      .expect(200);
    await request(server())
      .get('/api/v1/categories')
      .set(bearer(tokens.cashier))
      .expect(200);

    await request(server())
      .post('/api/v1/categories')
      .set(bearer(tokens.cashier))
      .send({ name: 'Denied' })
      .expect(403);
    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.cashier))
      .send({ sku: 'X', name: 'X', unit: 'piece', current_price: 1 })
      .expect(403);

    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.manager))
      .send({
        name: 'Manager item',
        unit: 'piece',
        current_price: 1,
      })
      .expect(201);

    await request(server())
      .post(`/api/v1/items/${item.body.id}/price`)
      .set(bearer(tokens.cashier))
      .send({ new_price: 1200 })
      .expect(403);
    await request(server())
      .post(`/api/v1/items/${item.body.id}/price`)
      .set(bearer(tokens.manager))
      .send({ new_price: 1200 })
      .expect(200);
  });

  it('hides cost_price from cashiers at the response-shaping level', async () => {
    const item = await createItem({ cost_price: 700 });

    const adminView = await request(server())
      .get(`/api/v1/items/${item.body.id}`)
      .set(bearer(tokens.admin))
      .expect(200);
    expect(adminView.body.cost_price).toBe(700);

    const managerView = await request(server())
      .get(`/api/v1/items/${item.body.id}`)
      .set(bearer(tokens.manager))
      .expect(200);
    expect(managerView.body.cost_price).toBe(700);

    const cashierView = await request(server())
      .get(`/api/v1/items/${item.body.id}`)
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(cashierView.body).not.toHaveProperty('cost_price');

    const cashierList = await request(server())
      .get('/api/v1/items')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(cashierList.body.data[0]).not.toHaveProperty('cost_price');
  });

  it('treats cross-store item and category ids as not found', async () => {
    const otherStoreId = (await createStore(context.prisma, { name: 'Other' }))
      .id;
    const otherCategory = await context.prisma.category.create({
      data: { store_id: otherStoreId, name: 'Other category' },
    });
    const otherItem = await context.prisma.item.create({
      data: {
        store_id: otherStoreId,
        sku: 'OTHER-SKU',
        name: 'Other item',
        unit: 'piece',
        current_price: 1,
      },
    });

    for (const path of [
      `/api/v1/items/${otherItem.id}`,
      `/api/v1/items/${otherItem.id}/price-history`,
    ]) {
      await request(server()).get(path).set(bearer(tokens.admin)).expect(404);
    }

    await request(server())
      .patch(`/api/v1/items/${otherItem.id}`)
      .set(bearer(tokens.admin))
      .send({ name: 'Nope' })
      .expect(404);
    await request(server())
      .post(`/api/v1/items/${otherItem.id}/price`)
      .set(bearer(tokens.manager))
      .send({ new_price: 1 })
      .expect(404);
    await request(server())
      .get(`/api/v1/categories/${otherCategory.id}`)
      .set(bearer(tokens.admin))
      .expect(404);
    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .send({
        name: 'Cross store category',
        unit: 'piece',
        current_price: 1,
        category_id: otherCategory.id,
      })
      .expect(404);
  });

  it('normalizes category names and enforces case-insensitive uniqueness', async () => {
    const created = await createCategory('  Hot   Drinks ');
    expect(created.body.name).toBe('Hot Drinks');

    await request(server())
      .post('/api/v1/categories')
      .set(bearer(tokens.admin))
      .send({ name: 'hot drinks' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('category_name_taken');
      });

    await createCategory('Coffee', tokens.admin);
    await request(server())
      .post('/api/v1/categories')
      .set(bearer(tokens.admin))
      .send({ name: 'coffee' })
      .expect(409);
  });

  it('enforces barcode uniqueness, normalizes empty barcodes, and generates unique SKUs', async () => {
    // 1. Create an item with a barcode
    const item = await createItem({ barcode: '123456' });
    expect(item.body.sku).toBeTruthy();
    expect(item.body.barcode).toBe('123456');

    // 2. Duplicate barcode → 409
    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .send({
        name: 'Duplicate barcode',
        unit: 'piece',
        current_price: 1,
        barcode: '123456',
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('duplicate_barcode');
      });

    // 3. Empty / whitespace barcodes are normalized to null
    const noBarcode = await createItem({ barcode: '   ' });
    expect(noBarcode.body.barcode).toBeNull();

    const noBarcode2 = await createItem({ barcode: '' });
    expect(noBarcode2.body.barcode).toBeNull();

    // 4. Generated SKUs are unique
    const another = await createItem();
    expect(another.body.sku).toBeTruthy();
    expect(another.body.sku).not.toBe(item.body.sku);

    // 5. Barcode lookup still works
    await request(server())
      .get('/api/v1/items/barcode/123456')
      .set(bearer(tokens.cashier))
      .expect(200)
      .expect((response) => {
        expect(response.body.id).toBe(item.body.id);
      });

    await request(server())
      .get('/api/v1/items/barcode/does-not-exist')
      .set(bearer(tokens.cashier))
      .expect(404);
  });

  it('changes price atomically, records history, and treats unchanged price as no-op', async () => {
    const item = await createItem({ current_price: 1000 });

    await request(server())
      .post(`/api/v1/items/${item.body.id}/price`)
      .set(bearer(tokens.manager))
      .send({ new_price: 1500 })
      .expect(200);

    const history = await request(server())
      .get(`/api/v1/items/${item.body.id}/price-history`)
      .set(bearer(tokens.cashier))
      .expect(200);

    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      old_price: 1000,
      new_price: 1500,
    });

    const audits = await context.prisma.auditLog.findMany({
      where: { action: 'item.price_changed', entity_id: item.body.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toMatchObject({
      old_price: 1000,
      new_price: 1500,
    });

    await request(server())
      .post(`/api/v1/items/${item.body.id}/price`)
      .set(bearer(tokens.manager))
      .send({ new_price: 1500 })
      .expect(200);

    expect(
      await context.prisma.priceHistory.count({
        where: { item_id: item.body.id },
      }),
    ).toBe(1);
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'item.price_changed', entity_id: item.body.id },
      }),
    ).toBe(1);
  });

  it('rejects stock_quantity on create and update and starts stock at zero', async () => {
    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .send({
        name: 'Stock item',
        unit: 'piece',
        current_price: 1,
        stock_quantity: 10,
      })
      .expect(400);

    const item = await createItem({});
    expect(item.body.stock_quantity).toBe(0);

    await request(server())
      .patch(`/api/v1/items/${item.body.id}`)
      .set(bearer(tokens.admin))
      .send({ stock_quantity: 5 })
      .expect(400);
  });

  it('deactivates instead of deleting and exposes no delete route', async () => {
    const item = await createItem();

    const deactivated = await request(server())
      .post(`/api/v1/items/${item.body.id}/deactivate`)
      .set(bearer(tokens.admin))
      .expect(200);
    expect(deactivated.body.active).toBe(false);

    await request(server())
      .delete(`/api/v1/items/${item.body.id}`)
      .set(bearer(tokens.admin))
      .expect(404);

    const audits = await context.prisma.auditLog.findMany({
      where: { action: 'item.deactivated', entity_id: item.body.id },
    });
    expect(audits).toHaveLength(1);
  });

  it('paginates deterministically and supports filter combinations', async () => {
    const food = await createCategory('Food');
    const drinks = await createCategory('Drinks');

    const alpha = await createItem({
      name: 'Alpha',
      category_id: food.body.id,
    });
    await createItem({
      name: 'Bravo',
      category_id: food.body.id,
    });
    await createItem({
      name: 'Charlie',
      category_id: drinks.body.id,
    });
    const delta = await createItem({
      name: 'Delta',
      category_id: food.body.id,
    });

    // Deactivate one item
    await request(server())
      .post(`/api/v1/items/${delta.body.id}/deactivate`)
      .set(bearer(tokens.admin))
      .expect(200);

    // ---- Pagination (ordered by name) ----
    const page1 = await request(server())
      .get('/api/v1/items?page=1&page_size=2')
      .set(bearer(tokens.cashier))
      .expect(200);

    const page2 = await request(server())
      .get('/api/v1/items?page=2&page_size=2')
      .set(bearer(tokens.cashier))
      .expect(200);

    expect(page1.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Alpha',
      'Bravo',
    ]);
    expect(page2.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Charlie',
      'Delta',
    ]);
    expect(page1.body.meta.total).toBe(4);

    // ---- Filter combination: category + active + search ----
    const filtered = await request(server())
      .get(`/api/v1/items?category_id=${food.body.id}&active=true&q=a`)
      .set(bearer(tokens.cashier))
      .expect(200);

    // Assert by name (or id) – never by generated SKU
    expect(filtered.body.data.map((row: { name: string }) => row.name)).toEqual(
      ['Alpha', 'Bravo'],
    );
    // Optional extra safety
    expect(
      filtered.body.data.every((row: { active: boolean }) => row.active),
    ).toBe(true);

    // ---- Low-stock filter ----
    await context.prisma.item.update({
      where: { id: alpha.body.id }, // use the known id
      data: { stock_quantity: 2, reorder_threshold: 5 },
    });

    const lowStock = await request(server())
      .get('/api/v1/items?low_stock=true')
      .set(bearer(tokens.cashier))
      .expect(200);

    expect(lowStock.body.data.map((row: { name: string }) => row.name)).toEqual(
      ['Alpha'],
    );
  });

  it('writes category and item audit entries with the actor', async () => {
    const category = await createCategory('Audited');
    const item = await createItem({ category_id: category.body.id });

    const categoryAudits = await context.prisma.auditLog.findMany({
      where: {
        action: 'category.created',
        entity_id: category.body.id,
      },
    });
    const itemAudits = await context.prisma.auditLog.findMany({
      where: { action: 'item.created', entity_id: item.body.id },
    });

    expect(categoryAudits).toHaveLength(1);
    expect(itemAudits).toHaveLength(1);
    expect(itemAudits[0].staff_id).toBe(adminId);
    expect(itemAudits[0].store_id).toBe(storeId);
  });

  it('rejects item creation with image when storage is disabled', async () => {
    const image = await imageBuffer('png');

    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .field('name', 'With image')
      .field('unit', 'piece')
      .field('current_price', '1000')
      .attach('image', image, 'photo.png')
      .expect(503)
      .expect((res) => {
        expect(res.body.code).toBe('image_storage_disabled');
      });
  });

  it('creates an item without an image when none is supplied', async () => {
    const res = await createItem({ name: 'No image' });
    expect(res.body.image_url).toBeUndefined();
  });

  it('allows creating an item with an image - admin/manager only', async () => {
    const image = await imageBuffer('png');

    // Cashier forbidden
    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.cashier))
      .field('name', 'With image')
      .field('unit', 'piece')
      .field('current_price', '1000')
      .attach('image', image, 'photo.png')
      .expect(403);

    // Admin succeeds
    const res = await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .field('name', 'With image')
      .field('unit', 'piece')
      .field('current_price', '1000')
      .attach('image', image, 'photo.png')
      .expect(201);

    expect(res.body.image_key).toMatch(
      /^items\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+$/,
    );
    expect(storage.uploads).toContain(res.body.image_key);
  });

  it('does not create an item when image upload fails', async () => {
    const image = await imageBuffer('png');

    // Force the next upload to fail
    storage.failNextUpload = true;

    const beforeCount = await context.prisma.item.count({
      where: { store_id: storeId },
    });

    await request(server())
      .post('/api/v1/items')
      .set(bearer(tokens.admin))
      .field('name', 'Should not be created')
      .field('unit', 'piece')
      .field('current_price', '1000')
      .attach('image', image, 'photo.png')
      .expect(503);

    // No item was written
    const afterCount = await context.prisma.item.count({
      where: { store_id: storeId },
    });
    expect(afterCount).toBe(beforeCount);

    // Nothing left in storage either
    expect(storage.uploads).toHaveLength(0);
    expect(storage.objects.size).toBe(0);

    // No audit entry for a non-existent item
    expect(
      await context.prisma.auditLog.count({
        where: {
          action: 'item.created',
          details: { path: ['name'], equals: 'Should not be created' },
        },
      }),
    ).toBe(0);
  });
});
