import { describe, expect, it, vi } from 'vitest';

import type {
  ItemModel,
  PriceHistoryModel,
} from '../../generated/prisma/models.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type { ImageProcessor } from './image/image-processor.js';
import type { ImageStorage } from './image/image-storage.js';
import * as itemUnitEnum from './item-unit.enum.js';
import { ItemUnit } from './item-unit.enum.js';
import { ItemsService } from './items.service.js';
import { ConflictException } from '@nestjs/common';

const MANAGER: Principal = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'manager',
  timezone: 'UTC',
};

const CASHIER: Principal = { ...MANAGER, role: 'cashier' };
const ADMIN: Principal = { ...MANAGER, role: 'admin' };
const OTHER_STORE_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const REORDER_FIELD = { name: 'reorder_threshold' };
const NOW = new Date('2026-11-06T12:00:00.000Z');

function buildItem(overrides: Partial<ItemModel> = {}): ItemModel {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    store_id: MANAGER.store_id,
    sku: 'GEN-ABC123',
    barcode: '0123456789',
    image_key: null,
    name: 'Coca Cola',
    category_id: null,
    unit: ItemUnit.BOTTLE,
    current_price: 1_000,
    cost_price: 700,
    stock_quantity: Number(0),
    reorder_threshold: 0,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function buildPriceHistory(
  overrides: Partial<PriceHistoryModel> & {
    changed_by?: {
      id: string;
      first_name: string;
      last_name: string;
    } | null;
  } = {},
): PriceHistoryModel & {
  changed_by?: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
} {
  const { changed_by, ...rest } = overrides;

  return {
    id: '66666666-6666-4666-8666-666666666666',
    item_id: buildItem().id,
    old_price: 1_000,
    new_price: 1_200,
    changed_by_staff_id: MANAGER.staff_id,
    changed_at: NOW,
    changed_by: changed_by ?? {
      id: MANAGER.staff_id,
      first_name: 'Ada',
      last_name: 'Manager',
    },
    ...rest,
  };
}

function createService() {
  const item = {
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
    fields: { reorder_threshold: REORDER_FIELD },
  };
  const category = { findFirst: vi.fn() };
  const priceHistory = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
  };
  const prisma: Record<string, unknown> = { item, category, priceHistory };
  const transaction = vi.fn(async (argument: unknown) => {
    if (typeof argument === 'function') {
      return (argument as (tx: unknown) => unknown)(prisma);
    }
    return Promise.all(argument as Promise<unknown>[]);
  });
  prisma.$transaction = transaction;

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const imageProcessor = { normalize: vi.fn() };
  const storage = {
    enabled: true,
    upload: vi.fn(),
    remove: vi.fn(),
    url: vi.fn(),
  };

  const service = new ItemsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    imageProcessor as unknown as ImageProcessor,
    storage as unknown as ImageStorage,
  );

  return {
    service,
    item,
    category,
    priceHistory,
    transaction,
    audit,
    imageProcessor,
    storage,
  };
}

describe('ItemsService.create', () => {
  it('persists normalised values, defaults, store scope and an audit entry', async () => {
    const { service, item, audit, transaction } = createService();
    const created = buildItem({
      id: '77777777-7777-4777-8777-777777777777',
      barcode: '0123456789',
      name: 'Coca Cola 50cl',
      unit: ItemUnit.BOTTLE,
      current_price: 1_000,
      cost_price: null,
      reorder_threshold: 0,
      active: true,
    });
    item.findFirst.mockResolvedValue(null);
    item.create.mockResolvedValue(created);

    const result = await service.create(MANAGER, {
      name: '  Coca   Cola 50cl ',
      barcode: ' 0123456789 ',
      unit: ItemUnit.BOTTLE,
      current_price: 1_000,
    });

    expect(item.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        store_id: MANAGER.store_id,
        sku: expect.stringMatching(/^GEN-[A-Z0-9]{6}$/),
        barcode: '0123456789',
        name: 'Coca Cola 50cl',
        category_id: null,
        unit: 'bottle',
        current_price: 1_000,
        cost_price: null,
        reorder_threshold: 0,
        active: true,
        image_key: null,
      },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: MANAGER.store_id,
        staff_id: MANAGER.staff_id,
        action: AUDIT_ACTIONS.itemCreated,
        entity_type: 'Item',
        entity_id: created.id,
        details: expect.objectContaining({
          sku: created.sku,
          name: created.name,
          current_price: created.current_price,
          reorder_threshold: created.reorder_threshold,
          has_image: false,
        }),
      }),
      expect.anything(),
    );
    expect(result.id).toBe(created.id);
  });

  it('uses explicit optional values when provided', async () => {
    const { service, item, category } = createService();
    const created = buildItem({
      category_id: CATEGORY_ID,
      cost_price: 500,
      reorder_threshold: 7,
      active: false,
    });
    item.findFirst.mockResolvedValue(null);
    category.findFirst.mockResolvedValue({ id: CATEGORY_ID, name: 'Drinks' });
    item.create.mockResolvedValue(created);

    await service.create(MANAGER, {
      name: 'Low stock item',
      unit: ItemUnit.CASE,
      current_price: 2_000,
      cost_price: 500,
      reorder_threshold: 7,
      active: false,
      category_id: CATEGORY_ID,
    });

    expect(item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category_id: CATEGORY_ID,
        unit: 'case',
        cost_price: 500,
        reorder_threshold: 7,
        active: false,
      }),
    });
  });

  it('rejects an invalid unit before any write or audit', async () => {
    const { service, item, audit, transaction } = createService();

    await expect(
      service.create(MANAGER, {
        name: 'Bad unit',
        unit: 'kg' as unknown as ItemUnit,
        current_price: 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_unit' });

    expect(transaction).not.toHaveBeenCalled();
    expect(item.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(Object.values(ItemUnit))(
    'persists the %s unit when called without a DTO',
    async (unit) => {
      const { service, item } = createService();
      item.findFirst.mockResolvedValue(null);
      item.create.mockResolvedValue(buildItem({ unit }));

      await service.create(MANAGER, {
        name: 'Unit check',
        unit,
        current_price: 1,
      });

      expect(item.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ unit }),
      });
    },
  );

  it('rejects a barcode already used in the same store', async () => {
    const { service, item, transaction } = createService();
    item.findFirst.mockImplementation(
      ({ where }: { where: { barcode?: string } }) =>
        Promise.resolve(where.barcode ? { id: 'existing' } : null),
    );

    await expect(
      service.create(MANAGER, {
        name: 'Duplicate',
        barcode: 'DUPLICATE',
        unit: ItemUnit.PIECE,
        current_price: 1,
      }),
    ).rejects.toMatchObject({ code: 'duplicate_barcode' });

    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns a 404 when the category is outside the store', async () => {
    const { service, item, category, transaction } = createService();
    item.findFirst.mockResolvedValue(null);
    category.findFirst.mockResolvedValue(null);

    await expect(
      service.create(MANAGER, {
        name: 'Unknown category',
        category_id: CATEGORY_ID,
        unit: ItemUnit.PIECE,
        current_price: 1,
      }),
    ).rejects.toMatchObject({ code: 'category_not_found' });

    expect(category.findFirst).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID, store_id: MANAGER.store_id },
      select: { id: true, name: true },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['barcode', ['store_id', 'barcode']],
    ['SKU', ['store_id', 'sku']],
  ])('maps a database unique violation on %s', async (label, target) => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);
    item.create.mockRejectedValue({ code: 'P2002', meta: { target } });

    const expectedCode =
      label === 'barcode' ? 'duplicate_barcode' : 'duplicate_sku';

    await expect(
      service.create(MANAGER, {
        name: 'Duplicate',
        unit: ItemUnit.PIECE,
        current_price: 1,
      }),
    ).rejects.toMatchObject({ code: expectedCode });
  });
});

describe('ItemsService.update', () => {
  it('only changes provided fields and writes an audit entry', async () => {
    const { service, item, audit } = createService();
    const existing = buildItem({
      name: 'Old Name',
      unit: ItemUnit.PIECE,
      reorder_threshold: 2,
    });
    const updated = buildItem({
      ...existing,
      name: 'New Name',
      unit: ItemUnit.CAN,
      reorder_threshold: 5,
    });

    item.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    item.update.mockResolvedValue(updated);

    const result = await service.update(MANAGER, existing.id, {
      name: '  New   Name ',
      unit: ItemUnit.CAN,
      reorder_threshold: 5,
    });

    expect(item.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: {
        name: 'New Name',
        unit: 'can',
        reorder_threshold: 5,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.itemUpdated,
        entity_id: existing.id,
        details: { fields: ['name', 'unit', 'reorder_threshold'] },
      }),
      expect.anything(),
    );
    expect(result.name).toBe('New Name');
  });

  it('rejects an invalid unit before any write or audit', async () => {
    const { service, item, audit, transaction } = createService();
    const existing = buildItem();
    item.findFirst.mockResolvedValue(existing);

    await expect(
      service.update(MANAGER, existing.id, {
        unit: 'kg' as unknown as ItemUnit,
      }),
    ).rejects.toMatchObject({ code: 'invalid_unit' });

    expect(transaction).not.toHaveBeenCalled();
    expect(item.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(Object.values(ItemUnit))(
    'accepts the %s unit when called without a DTO',
    async (unit) => {
      const { service, item } = createService();
      const existing = buildItem({ unit: 'legacy-unit' });
      item.findFirst.mockResolvedValue(existing);
      item.update.mockResolvedValue({ ...existing, unit });

      const result = await service.update(MANAGER, existing.id, { unit });

      expect(item.update).toHaveBeenCalledWith({
        where: { id: existing.id },
        data: { unit },
      });
      expect(result.unit).toBe(unit);
    },
  );

  it('does not invoke the unit guard when unit is omitted', async () => {
    const { service, item } = createService();
    const existing = buildItem({ name: 'Old Name' });

    item.findFirst
      .mockResolvedValueOnce(existing) // load item
      .mockResolvedValueOnce(null); // name is available
    item.update.mockResolvedValue({ ...existing, name: 'New Name' });

    const guard = vi.spyOn(itemUnitEnum, 'assertValidUnit');

    await service.update(MANAGER, existing.id, { name: 'New Name' });

    expect(guard).not.toHaveBeenCalled();
    guard.mockRestore();
  });

  it('returns the existing item without writing when nothing changed', async () => {
    const { service, item, audit, transaction } = createService();
    const existing = buildItem();
    item.findFirst.mockResolvedValue(existing);

    const result = await service.update(MANAGER, existing.id, {});

    expect(result.id).toBe(existing.id);
    expect(transaction).not.toHaveBeenCalled();
    expect(item.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 404 when the item belongs to another store', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.update(MANAGER, buildItem({ store_id: OTHER_STORE_ID }).id, {
        name: 'Nope',
      }),
    ).rejects.toMatchObject({ code: 'item_not_found' });

    expect(item.findFirst).toHaveBeenCalledWith({
      where: {
        id: buildItem({ store_id: OTHER_STORE_ID }).id,
        store_id: MANAGER.store_id,
      },
    });
  });

  it('forbids non-admin activation changes', async () => {
    const { service, item, transaction } = createService();
    item.findFirst.mockResolvedValue(buildItem({ active: true }));

    await expect(
      service.update(MANAGER, buildItem().id, { active: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(transaction).not.toHaveBeenCalled();
  });

  it('lets an admin reactivate an item through the active field', async () => {
    const { service, item } = createService();
    const existing = buildItem({ active: false });
    item.findFirst.mockResolvedValue(existing);
    item.update.mockResolvedValue({ ...existing, active: true });

    const result = await service.update(ADMIN, existing.id, { active: true });

    expect(item.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { active: true },
    });
    expect(result.active).toBe(true);
  });
});

describe('ItemsService.deactivate', () => {
  it('deactivates an active item and writes an audit entry', async () => {
    const { service, item, audit } = createService();
    const existing = buildItem({ active: true });
    item.findFirst.mockResolvedValue(existing);
    item.update.mockResolvedValue({ ...existing, active: false });

    const result = await service.deactivate(ADMIN, existing.id);

    expect(item.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { active: false },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.itemDeactivated,
        entity_id: existing.id,
        details: { active: false },
      }),
      expect.anything(),
    );
    expect(result.active).toBe(false);
  });

  it('is idempotent for an already inactive item', async () => {
    const { service, item, audit, transaction } = createService();
    const existing = buildItem({ active: false });
    item.findFirst.mockResolvedValue(existing);

    const result = await service.deactivate(ADMIN, existing.id);

    expect(result.active).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(item.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 404 for an item in another store', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.deactivate(ADMIN, buildItem().id),
    ).rejects.toMatchObject({ code: 'item_not_found' });
  });
});

describe('ItemsService.changePrice', () => {
  it('updates the price, records history and audit', async () => {
    const { service, item, priceHistory, audit } = createService();
    const existing = buildItem({ current_price: 1_000 });
    item.findFirst.mockResolvedValue(existing);
    item.update.mockResolvedValue({ ...existing, current_price: 1_200 });
    priceHistory.create.mockResolvedValue(buildPriceHistory());

    const result = await service.changePrice(MANAGER, existing.id, {
      new_price: 1_200,
    });

    expect(item.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { current_price: 1_200 },
    });
    expect(priceHistory.create).toHaveBeenCalledWith({
      data: {
        item_id: existing.id,
        old_price: 1_000,
        new_price: 1_200,
        changed_by_staff_id: MANAGER.staff_id,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.itemPriceChanged,
        details: { old_price: 1_000, new_price: 1_200 },
      }),
      expect.anything(),
    );
    expect(result.current_price).toBe(1_200);
  });

  it('does nothing when the new price equals the current price', async () => {
    const { service, item, priceHistory, audit } = createService();
    const existing = buildItem({ current_price: 1_000 });
    item.findFirst.mockResolvedValue(existing);

    const result = await service.changePrice(MANAGER, existing.id, {
      new_price: 1_000,
    });

    expect(result.current_price).toBe(1_000);
    expect(item.update).not.toHaveBeenCalled();
    expect(priceHistory.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns 404 for an item in another store', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.changePrice(MANAGER, buildItem().id, { new_price: 1 }),
    ).rejects.toMatchObject({ code: 'item_not_found' });
  });
});

describe('ItemsService.list', () => {
  it('uses store scoping, filters, pagination and shows cost to managers', async () => {
    const { service, item } = createService();
    const stored = buildItem({ cost_price: 400 });
    item.findMany.mockResolvedValue([stored]);
    item.count.mockResolvedValue(1);

    const result = await service.list(MANAGER, {
      page: 2,
      page_size: 10,
      category_id: CATEGORY_ID,
      active: true,
      q: 'coke',
      low_stock: true,
    });

    const expectedWhere = {
      store_id: MANAGER.store_id,
      category_id: CATEGORY_ID,
      active: true,
      OR: [
        { name: { contains: 'coke', mode: 'insensitive' } },
        { sku: { contains: 'coke', mode: 'insensitive' } },
        { barcode: { contains: 'coke', mode: 'insensitive' } },
      ],
      AND: [
        { reorder_threshold: { gt: 0 } },
        { stock_quantity: { lte: REORDER_FIELD } },
      ],
    };

    expect(item.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    });
    expect(item.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.meta).toEqual({
      page: 2,
      page_size: 10,
      total: 1,
      total_pages: 1,
    });
    expect(result.data[0].cost_price).toBe(400);
  });

  it('omits cost_price for cashiers', async () => {
    const { service, item } = createService();
    item.findMany.mockResolvedValue([buildItem({ cost_price: 400 })]);
    item.count.mockResolvedValue(1);

    const result = await service.list(CASHIER, { page: 1, page_size: 25 });

    expect(result.data[0]).not.toHaveProperty('cost_price');
    expect(item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: CASHIER.store_id },
        skip: 0,
        take: 25,
      }),
    );
  });
});

describe('ItemsService.findOne', () => {
  it('scopes the lookup to the principal store', async () => {
    const { service, item } = createService();
    const stored = buildItem({ cost_price: 400 });
    item.findFirst.mockResolvedValue(stored);

    const result = await service.findOne(MANAGER, stored.id);

    expect(item.findFirst).toHaveBeenCalledWith({
      where: { id: stored.id, store_id: MANAGER.store_id },
    });
    expect(result.cost_price).toBe(400);
  });

  it('returns 404 when the item is not in the principal store', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(MANAGER, buildItem().id),
    ).rejects.toMatchObject({ code: 'item_not_found' });
  });
});

describe('ItemsService.findByBarcode', () => {
  it('trims the barcode and scopes the lookup to the store', async () => {
    const { service, item } = createService();
    const stored = buildItem({ barcode: '0123456789' });
    item.findFirst.mockResolvedValue(stored);

    const result = await service.findByBarcode(MANAGER, ' 0123456789 ');

    expect(item.findFirst).toHaveBeenCalledWith({
      where: { store_id: MANAGER.store_id, barcode: '0123456789' },
    });
    expect(result.id).toBe(stored.id);
  });

  it('returns 404 when no item matches', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.findByBarcode(MANAGER, 'missing'),
    ).rejects.toMatchObject({ code: 'item_not_found' });
  });
});

describe('ItemsService.listPriceHistory', () => {
  it('checks item scope and paginates history newest first', async () => {
    const { service, item, priceHistory } = createService();
    const stored = buildItem();
    const entry = buildPriceHistory();
    item.findFirst.mockResolvedValue(stored);
    priceHistory.findMany.mockResolvedValue([entry]);
    priceHistory.count.mockResolvedValue(1);

    const result = await service.listPriceHistory(CASHIER, stored.id, {
      page: 2,
      page_size: 1,
    });

    expect(item.findFirst).toHaveBeenCalledWith({
      where: { id: stored.id, store_id: CASHIER.store_id },
    });
    expect(priceHistory.findMany).toHaveBeenCalledWith({
      where: { item_id: stored.id },
      orderBy: [{ changed_at: 'desc' }, { id: 'desc' }],
      skip: 1,
      take: 1,
      include: {
        changed_by: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
    expect(priceHistory.count).toHaveBeenCalledWith({
      where: { item_id: stored.id },
    });
    expect(result.meta).toEqual({
      page: 2,
      page_size: 1,
      total: 1,
      total_pages: 1,
    });
    expect(result.data[0]).toMatchObject({
      id: entry.id,
      old_price: entry.old_price,
      new_price: entry.new_price,
    });
  });

  it('returns 404 before querying history for another store', async () => {
    const { service, item, priceHistory } = createService();
    item.findFirst.mockResolvedValue(null);

    await expect(
      service.listPriceHistory(MANAGER, buildItem().id, {
        page: 1,
        page_size: 25,
      }),
    ).rejects.toMatchObject({ code: 'item_not_found' });

    expect(priceHistory.findMany).not.toHaveBeenCalled();
  });
});

describe('name uniqueness', () => {
  it('rejects create when an active item already has the same name', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(
      buildItem({ name: 'Coca-Cola 50cl', active: true }),
    );

    await expect(
      service.create(MANAGER, {
        name: '  Coca-Cola   50cl ',
        unit: ItemUnit.PIECE,
        current_price: 50000,
      }),
    ).rejects.toThrow(ConflictException);

    expect(item.create).not.toHaveBeenCalled();
  });

  it('rejects create when a deactivated item already has the same name', async () => {
    const { service, item } = createService();
    item.findFirst.mockResolvedValue(
      buildItem({ name: 'Coca-Cola 50cl', active: false }),
    );

    await expect(
      service.create(MANAGER, {
        name: 'Coca-Cola 50cl',
        unit: ItemUnit.PIECE,
        current_price: 50000,
      }),
    ).rejects.toThrow(/already exists \(currently deactivated\)/);

    expect(item.create).not.toHaveBeenCalled();
  });

  it('allows update when the name is unchanged', async () => {
    const { service, item } = createService();
    const existing = buildItem({ name: 'Same Name' });
    item.findFirst.mockResolvedValue(existing);
    item.update.mockResolvedValue(existing);

    await service.update(MANAGER, existing.id, {
      name: '  Same   Name ',
      reorder_threshold: 3,
    });

    // only the load call — no second findFirst for name check
    expect(item.findFirst).toHaveBeenCalledTimes(1);
    expect(item.update).toHaveBeenCalled();
  });

  it('rejects update when another item already has the new name', async () => {
    const { service, item } = createService();
    const existing = buildItem({ id: 'item-1', name: 'Old Name' });
    const conflict = buildItem({
      id: 'item-2',
      name: 'Taken Name',
      active: true,
    });

    item.findFirst
      .mockResolvedValueOnce(existing) // load item
      .mockResolvedValueOnce(conflict); // name conflict

    await expect(
      service.update(MANAGER, existing.id, { name: 'Taken Name' }),
    ).rejects.toThrow(/An active item named "Taken Name" already exists/);

    expect(item.update).not.toHaveBeenCalled();
  });

  it('allows update to a new unique name', async () => {
    const { service, item } = createService();
    const existing = buildItem({ name: 'Old Name' });
    const updated = buildItem({ ...existing, name: 'Brand New' });

    item.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    item.update.mockResolvedValue(updated);

    const result = await service.update(MANAGER, existing.id, {
      name: 'Brand New',
    });

    expect(item.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: { name: 'Brand New' },
    });
    expect(result.name).toBe('Brand New');
  });
});
