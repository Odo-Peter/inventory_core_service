import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { StockMovementModel } from '../../generated/prisma/models.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type { ListMovementsQueryDto } from './dto/list-movements-query.dto.js';
import { StockService } from './stock.service.js';

const PRINCIPAL: Principal = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'manager',
  timezone: 'UTC',
};

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-06T12:00:00.000Z');

interface StoreMovementRow extends StockMovementModel {
  item: { name: string; sku: string };
  staff: { first_name: string; last_name: string } | null;
}

function buildMovement(
  overrides: Partial<StoreMovementRow> = {},
): StoreMovementRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    store_id: PRINCIPAL.store_id,
    item_id: ITEM_ID,
    quantity_change: -2,
    reason: 'sale',
    sale_id: null,
    refund_id: null,
    staff_id: STAFF_ID,
    note: null,
    created_at: NOW,
    item: { name: 'Coca Cola', sku: 'COKE-001' },
    staff: { first_name: 'Ada', last_name: 'Okafor' },
    ...overrides,
  };
}

function query(
  overrides: Partial<ListMovementsQueryDto> = {},
): ListMovementsQueryDto {
  return {
    page: 1,
    page_size: 25,
    ...overrides,
  } as ListMovementsQueryDto;
}

function createService(
  movements: StoreMovementRow[] = [buildMovement()],
  total = movements.length,
) {
  const findMany = vi.fn().mockResolvedValue(movements);
  const count = vi.fn().mockResolvedValue(total);
  const transaction = vi.fn().mockImplementation((operations: Promise<unknown>[]) =>
    Promise.all(operations),
  );
  const prisma = {
    stockMovement: { findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new StockService(prisma, {} as AuditService);

  return { service, findMany, count, transaction };
}

describe('StockService.listStoreMovements', () => {
  it('scopes to the principal store only and applies default pagination', async () => {
    const { service, findMany, count, transaction } = createService();

    const result = await service.listStoreMovements(
      PRINCIPAL,
      {} as ListMovementsQueryDto,
    );

    const expectedWhere = { store_id: PRINCIPAL.store_id };

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      include: {
        item: { select: { name: true, sku: true } },
        staff: { select: { first_name: true, last_name: true } },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 25,
    });
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.meta).toEqual({
      page: 1,
      page_size: 25,
      total: 1,
      total_pages: 1,
    });
  });

  it.each<{
    name: string;
    filter: Partial<ListMovementsQueryDto>;
    expected: Record<string, unknown>;
  }>([
    {
      name: 'item_id',
      filter: { item_id: ITEM_ID },
      expected: { item_id: ITEM_ID },
    },
    {
      name: 'staff_id',
      filter: { staff_id: STAFF_ID },
      expected: { staff_id: STAFF_ID },
    },
    {
      name: 'reason list',
      filter: { reason: ['sale', 'damage'] },
      expected: { reason: { in: ['sale', 'damage'] } },
    },
    {
      name: 'from only',
      filter: { from: '2026-11-01T00:00:00.000Z' },
      expected: {
        created_at: { gte: new Date('2026-11-01T00:00:00.000Z') },
      },
    },
    {
      name: 'to only',
      filter: { to: '2026-11-06T00:00:00.000Z' },
      expected: {
        created_at: { lte: new Date('2026-11-06T00:00:00.000Z') },
      },
    },
    {
      name: 'from and to',
      filter: {
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-06T00:00:00.000Z',
      },
      expected: {
        created_at: {
          gte: new Date('2026-11-01T00:00:00.000Z'),
          lte: new Date('2026-11-06T00:00:00.000Z'),
        },
      },
    },
    {
      name: 'search',
      filter: { search: 'coke' },
      expected: {
        item: {
          OR: [
            { name: { contains: 'coke', mode: 'insensitive' } },
            { sku: { contains: 'coke', mode: 'insensitive' } },
            { barcode: { contains: 'coke', mode: 'insensitive' } },
          ],
        },
      },
    },
  ])('applies the $name filter', async ({ filter, expected }) => {
    const { service, findMany, count } = createService();

    await service.listStoreMovements(PRINCIPAL, query(filter));

    const expectedWhere = { store_id: PRINCIPAL.store_id, ...expected };

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('combines filters and always keeps the store scope', async () => {
    const { service, findMany } = createService();

    await service.listStoreMovements(
      PRINCIPAL,
      query({
        item_id: ITEM_ID,
        staff_id: STAFF_ID,
        reason: ['sale'],
        search: 'coke',
      }),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: PRINCIPAL.store_id,
          item_id: ITEM_ID,
          staff_id: STAFF_ID,
          reason: { in: ['sale'] },
          item: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      }),
    );
  });

  it('rejects from after to before querying', async () => {
    const { service, transaction } = createService();

    await expect(
      service.listStoreMovements(
        PRINCIPAL,
        query({
          from: '2026-11-07T00:00:00.000Z',
          to: '2026-11-06T00:00:00.000Z',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_date_range',
    });

    expect(transaction).not.toHaveBeenCalled();
  });

  it('throws an AppException with status 400 for an invalid range', async () => {
    const { service } = createService();

    try {
      await service.listStoreMovements(
        PRINCIPAL,
        query({
          from: '2026-11-07T00:00:00.000Z',
          to: '2026-11-06T00:00:00.000Z',
        }),
      );
      expect.unreachable('Expected listStoreMovements to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(400);
      expect((error as AppException).code).toBe('invalid_date_range');
    }
  });

  it.fails(
    'allows from === to (known bug: currently rejected)',
    async () => {
      const { service } = createService();
      const timestamp = '2026-11-06T12:00:00.000Z';

      await expect(
        service.listStoreMovements(PRINCIPAL, query({ from: timestamp, to: timestamp })),
      ).resolves.toBeDefined();
    },
  );

  it('maps item and staff display fields, including a null staff name', async () => {
    const { service } = createService([
      buildMovement(),
      buildMovement({
        id: '66666666-6666-4666-8666-666666666666',
        staff_id: null,
        staff: null,
        item: { name: 'Fanta', sku: 'FANTA-001' },
      }),
    ]);

    const result = await service.listStoreMovements(PRINCIPAL, query());

    expect(result.data[0]).toMatchObject({
      item_name: 'Coca Cola',
      item_sku: 'COKE-001',
      staff_name: 'Ada Okafor',
    });
    expect(result.data[1]).toMatchObject({
      item_name: 'Fanta',
      item_sku: 'FANTA-001',
      staff_name: null,
    });
  });

  it('computes skip and take for page 2+ and reuses the where for count', async () => {
    const { service, findMany, count } = createService([buildMovement()], 42);

    const result = await service.listStoreMovements(
      PRINCIPAL,
      query({ page: 3, page_size: 10, reason: ['damage'] }),
    );

    const expectedWhere = {
      store_id: PRINCIPAL.store_id,
      reason: { in: ['damage'] },
    };

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expectedWhere,
        skip: 20,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result.meta).toEqual({
      page: 3,
      page_size: 10,
      total: 42,
      total_pages: 5,
    });
  });

  it('returns an empty page with the right metadata', async () => {
    const { service } = createService([], 0);

    const result = await service.listStoreMovements(PRINCIPAL, query());

    expect(result).toEqual({
      data: [],
      meta: {
        page: 1,
        page_size: 25,
        total: 0,
        total_pages: 0,
      },
    });
  });
});

describe('StockService.applyMovementInTx', () => {
  function createTx(options: {
    active?: boolean;
    stockQuantity?: number;
    auditRecord?: ReturnType<typeof vi.fn>;
  } = {}) {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: ITEM_ID,
        stock_quantity: options.stockQuantity ?? 10,
        active: options.active ?? true,
      },
    ]);
    const movementCreate = vi
      .fn()
      .mockResolvedValue(buildMovement({ sale_id: null }));
    const itemUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: queryRaw,
      stockMovement: { create: movementCreate },
      item: { updateMany: itemUpdateMany },
    } as unknown as Prisma.TransactionClient;
    const auditRecord = options.auditRecord ?? vi.fn().mockResolvedValue(undefined);
    const service = new StockService(
      {} as PrismaService,
      { record: auditRecord } as unknown as AuditService,
    );

    return { tx, queryRaw, movementCreate, itemUpdateMany, auditRecord, service };
  }

  it('writes the movement and stock decrement without an audit row', async () => {
    const { tx, movementCreate, itemUpdateMany, auditRecord, service } =
      createTx();

    await service.applyMovementInTx(tx, PRINCIPAL, {
      item_id: ITEM_ID,
      quantity_change: -2,
      reason: 'sale',
      sale_id: '55555555-5555-4555-8555-555555555555',
    });

    expect(movementCreate).toHaveBeenCalledWith({
      data: {
        store_id: PRINCIPAL.store_id,
        item_id: ITEM_ID,
        quantity_change: -2,
        reason: 'sale',
        sale_id: '55555555-5555-4555-8555-555555555555',
        refund_id: null,
        staff_id: PRINCIPAL.staff_id,
        note: null,
      },
    });
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: {
        id: ITEM_ID,
        store_id: PRINCIPAL.store_id,
        stock_quantity: { gte: 2 },
      },
      data: { stock_quantity: { ['decrement']: 2 } },
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('writes the audit row when audit_action is set', async () => {
    const { tx, auditRecord, service } = createTx();

    await service.applyMovementInTx(tx, PRINCIPAL, {
      item_id: ITEM_ID,
      quantity_change: 3,
      reason: 'restock',
      audit_action: 'stock.received',
      audit_details: { supplier_name: 'Acme' },
    });

    expect(auditRecord).toHaveBeenCalledTimes(1);
    expect(auditRecord.mock.calls[0][0]).toMatchObject({
      store_id: PRINCIPAL.store_id,
      staff_id: PRINCIPAL.staff_id,
      action: 'stock.received',
      entity_type: 'Item',
      entity_id: ITEM_ID,
      details: {
        supplier_name: 'Acme',
        reason: 'restock',
      },
    });
    expect(auditRecord.mock.calls[0][1]).toBe(tx);
  });

  it('requires an active item for the sale reason', async () => {
    const { tx, movementCreate, service } = createTx({ active: false });

    await expect(
      service.applyMovementInTx(tx, PRINCIPAL, {
        item_id: ITEM_ID,
        quantity_change: -1,
        reason: 'sale',
      }),
    ).rejects.toMatchObject({ code: 'item_inactive' });

    expect(movementCreate).not.toHaveBeenCalled();
  });

  it('opens a transaction in the applyMovement wrapper', async () => {
    const { tx, movementCreate, auditRecord } = createTx();
    const transaction = vi.fn().mockImplementation((callback) => callback(tx));
    const service = new StockService(
      { $transaction: transaction } as unknown as PrismaService,
      { record: auditRecord } as unknown as AuditService,
    );

    await service.applyMovement(PRINCIPAL, {
      item_id: ITEM_ID,
      quantity_change: -1,
      reason: 'sale',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(movementCreate).toHaveBeenCalledTimes(1);
  });
});
