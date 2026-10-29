import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '../src/generated/prisma/enums.js';
import { MAX_IMAGE_BYTES } from '../src/modules/catalog/image/image-storage.js';
import { MemoryImageStorage } from './helpers/image-storage.fake.js';
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

describe('Item images (e2e)', () => {
  let context: TestContext;
  let storage: MemoryImageStorage;
  let storeId: string;
  let tokens: Record<StaffRole, string>;
  let itemSequence = 0;

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
  });

  async function createItem(store = storeId) {
    itemSequence += 1;
    return context.prisma.item.create({
      data: {
        store_id: store,
        sku: `IMAGE-${itemSequence}`,
        name: `Image item ${itemSequence}`,
        unit: 'piece',
        current_price: 1000,
      },
    });
  }

  function uploadImage(
    itemId: string,
    buffer: Buffer,
    filename = 'photo.png',
    token = tokens.admin,
  ) {
    return request(server())
      .put(`/api/v1/items/${itemId}/image`)
      .set(bearer(token))
      .attach('image', buffer, filename);
  }

  it('restricts image changes to admins', async () => {
    const item = await createItem(); // Prisma model → item.id
    const image = await imageBuffer('png');

    await uploadImage(item.id, image, 'photo.png', tokens.cashier).expect(403);
    await uploadImage(item.id, image, 'photo.png', tokens.manager).expect(403);

    // Admin can replace / upload
    await uploadImage(item.id, image).expect(200);
  });

  it('stores one key, converts to WebP, and returns sized variants', async () => {
    const item = await createItem();

    const response = await uploadImage(
      item.id,
      await imageBuffer('png'),
    ).expect(201);

    expect(response.body.item_id).toBe(item.id);
    expect(response.body.image_key).toMatch(
      new RegExp(`^items/${storeId}/${item.id}/[0-9a-f-]+$`),
    );
    expect(response.body.variants).toEqual({
      thumb: `https://images.test/thumb/${response.body.image_key}`,
      full: `https://images.test/full/${response.body.image_key}`,
    });

    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.image_key).toBe(response.body.image_key);

    const object = storage.objects.get(response.body.image_key);
    expect(object?.contentType).toBe('image/webp');
    expect((await sharp(object!.data).metadata()).format).toBe('webp');

    const listed = await request(server())
      .get(`/api/v1/items/${item.id}`)
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(listed.body.image_key).toBe(response.body.image_key);

    const audit = await context.prisma.auditLog.findFirstOrThrow({
      where: { action: 'item.image_updated', entity_id: item.id },
    });
    expect(audit.details).toMatchObject({
      image_key: response.body.image_key,
      previous_image_key: null,
    });
  });

  it('replaces an image and removes the previous object best-effort', async () => {
    const item = await createItem();
    const first = await uploadImage(item.id, await imageBuffer('jpeg')).expect(
      201,
    );
    const second = await uploadImage(item.id, await imageBuffer('webp')).expect(
      201,
    );

    expect(second.body.image_key).not.toBe(first.body.image_key);
    expect(storage.removals).toContain(first.body.image_key);
    expect(storage.objects.has(first.body.image_key)).toBe(false);
    expect(storage.objects.has(second.body.image_key)).toBe(true);

    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.image_key).toBe(second.body.image_key);
  });

  it('removes an image idempotently and audits only the first removal', async () => {
    const item = await createItem();
    const uploaded = await uploadImage(
      item.id,
      await imageBuffer('png'),
    ).expect(201);

    const removed = await request(server())
      .delete(`/api/v1/items/${item.id}/image`)
      .set(bearer(tokens.admin))
      .expect(200);
    expect(removed.body).toMatchObject({
      item_id: item.id,
      image_key: null,
      variants: null,
    });
    expect(storage.removals).toEqual([uploaded.body.image_key]);

    const again = await request(server())
      .delete(`/api/v1/items/${item.id}/image`)
      .set(bearer(tokens.admin))
      .expect(200);
    expect(again.body.image_key).toBeNull();
    expect(storage.removals).toHaveLength(1);

    expect(
      await context.prisma.auditLog.count({
        where: { action: 'item.image_removed', entity_id: item.id },
      }),
    ).toBe(1);
  });

  it('rejects missing, oversized, invalid, and unsupported files', async () => {
    const item = await createItem();

    await request(server())
      .post(`/api/v1/items/${item.id}/image`)
      .set(bearer(tokens.admin))
      .field('note', 'no file')
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('image_required');
      });

    await uploadImage(item.id, Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);

    await uploadImage(item.id, Buffer.from('not an image'))
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('invalid_image');
      });

    await uploadImage(
      item.id,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      ),
      'image.svg',
    )
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('unsupported_image_type');
      });

    expect(storage.uploads).toHaveLength(0);
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'item.image_updated', entity_id: item.id },
      }),
    ).toBe(0);
  });

  it('does not persist an image when storage fails', async () => {
    const item = await createItem();
    storage.failNextUpload = true;

    await uploadImage(item.id, await imageBuffer('png'))
      .expect(502)
      .expect((res) => {
        expect(res.body.code).toBe('image_storage_error');
      });

    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.image_key).toBeNull();
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'item.image_updated', entity_id: item.id },
      }),
    ).toBe(0);
  });

  it('keeps the database authoritative when cleanup fails on removal', async () => {
    const item = await createItem();
    await uploadImage(item.id, await imageBuffer('png')).expect(201);
    storage.failNextRemove = true;

    await request(server())
      .delete(`/api/v1/items/${item.id}/image`)
      .set(bearer(tokens.admin))
      .expect(200);

    expect(
      (
        await context.prisma.item.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).image_key,
    ).toBeNull();
  });

  it('treats a cross-store item as not found', async () => {
    const otherStoreId = (await createStore(context.prisma, { name: 'Other' }))
      .id;
    const otherItem = await createItem(otherStoreId);

    await uploadImage(otherItem.id, await imageBuffer('png')).expect(404);
    await request(server())
      .delete(`/api/v1/items/${otherItem.id}/image`)
      .set(bearer(tokens.admin))
      .expect(404);
    expect(storage.uploads).toHaveLength(0);
  });
});

describe('Item images with storage disabled (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let adminToken: string;

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
      staffCode: 'ADMIN',
      role: 'admin',
    });
    adminToken = (await loginAs(context, 'ADMIN')).token;
  });

  it('returns 503 for uploads when no image storage is configured', async () => {
    const item = await context.prisma.item.create({
      data: {
        store_id: storeId,
        sku: 'NO-STORAGE',
        name: 'No storage',
        unit: 'piece',
        current_price: 1,
      },
    });

    await request(server())
      .post(`/api/v1/items/${item.id}/image`)
      .set(bearer(adminToken))
      .attach('file', await imageBuffer('png'), 'photo.png')
      .expect(503)
      .expect((res) => {
        expect(res.body.code).toBe('image_storage_disabled');
      });
  });

  it('still allows removing an already-null image', async () => {
    const item = await context.prisma.item.create({
      data: {
        store_id: storeId,
        sku: 'NO-STORAGE-2',
        name: 'No storage 2',
        unit: 'piece',
        current_price: 1,
      },
    });

    await request(server())
      .delete(`/api/v1/items/${item.id}/image`)
      .set(bearer(adminToken))
      .expect(200)
      .expect((res) => expect(res.body.image_key).toBeNull());
  });
});
