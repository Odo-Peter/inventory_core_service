import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { PaymentMethod } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type { StockService } from '../inventory/stock.service.js';
import type { CreateSaleDto } from './dto/create-sale.dto.js';
import type { ListSalesQueryDto } from './dto/list-sales-query.dto.js';
import type { SaleDetailRow, SaleListRow } from './sale.mapper.js';
import { SalesService } from './sales.service.js';

const STORE_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF_ID = '44444444-4444-4444-8444-444444444444';
const SHIFT_ID = '55555555-5555-4555-8555-555555555555';
const SALE_ID = '66666666-6666-4666-8666-666666666666';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const ITEM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-11-08T10:00:00.000Z');
const DEFAULT_STOCK = 10;
const LOW_STOCK = 1;

const PRINCIPAL: Principal = {
  staff_id: STAFF_ID,
  store_id: STORE_ID,
  role: 'cashier',
  timezone: 'UTC',
};

const MANAGER: Principal = { ...PRINCIPAL, role: 'manager' };

function lockedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_A,
    sku: 'SKU-A',
    name: 'Item A',
    unit: 'piece',
    current_price: 1_000,
    stock_quantity: DEFAULT_STOCK,
    active: true,
    ...overrides,
  };
}

function detailRow(overrides: Partial<SaleDetailRow> = {}): SaleDetailRow {
  return {
    id: SALE_ID,
    store_id: STORE_ID,
    receipt_number: 1,
    shift_id: SHIFT_ID,
    staff_id: STAFF_ID,
    subtotal: 2_000,
    tax_total: 0,
    total: 2_000,
    created_at: NOW,
    staff: { first_name: 'Ada', last_name: 'Okafor' },
    payment: {
      id: PAYMENT_ID,
      method: 'cash',
      amount: 2_000,
      pos_account_id: null,
      account_label: null,
    },
    items: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        item_id: ITEM_A,
        sku: 'SKU-A',
        name: 'Item A',
        unit: 'piece',
        unit_price: 1_000,
        quantity: 2,
        tax_amount: 0,
        line_total: 2_000,
      },
    ],
    ...overrides,
  };
}

function listRow(overrides: Partial<SaleListRow> = {}): SaleListRow {
  return {
    id: SALE_ID,
    store_id: STORE_ID,
    receipt_number: 1,
    shift_id: SHIFT_ID,
    staff_id: STAFF_ID,
    subtotal: 2_000,
    tax_total: 0,
    total: 2_000,
    created_at: NOW,
    staff: { first_name: 'Ada', last_name: 'Okafor' },
    payment: { method: 'cash' },
    _count: { items: 1 },
    ...overrides,
  };
}

function createDto(overrides: Partial<CreateSaleDto> = {}): CreateSaleDto {
  return {
    items: [{ item_id: ITEM_A, quantity: 2 }],
    payment_method: 'cash',
    expected_total: 2_000,
    ...overrides,
  };
}

function listQuery(
  overrides: Partial<ListSalesQueryDto> = {},
): ListSalesQueryDto {
  return { page: 1, page_size: 25, ...overrides } as ListSalesQueryDto;
}

function createHarness(options: {
  lockedItems?: ReturnType<typeof lockedItem>[];
  detail?: SaleDetailRow;
  saleRows?: SaleListRow[];
  totalSales?: number;
  shift?: { id: string } | null;
  account?: { id: string; label: string } | null;
  idempotentRows?: Array<{ id: string; staff_id: string } | null>;
  saleCreateError?: unknown;
  movementError?: unknown;
  receiptPrintCount?: number;
  accounts?: Array<{ id: string; label: string; type: string }>;
  aggregate?: unknown;
  groups?: unknown[];
  clockDate?: Date;
  storeTimezone?: string;
  dailyRows?: Array<{ day: string; total: string | number; count: number }>;
  methodRows?: Array<{
    method: PaymentMethod;
    total: string | number;
    count: number;
  }>;
} = {}) {
  const shiftFindFirst = vi
    .fn()
    .mockResolvedValue(options.shift === undefined ? { id: SHIFT_ID } : options.shift);
  const queryRaw = vi
    .fn()
    .mockResolvedValue(options.lockedItems ?? [lockedItem()]);
  const storeUpdate = vi.fn().mockResolvedValue({ sale_counter: 1 });
  const saleCreate = vi.fn().mockResolvedValue({ id: SALE_ID });
  if (options.saleCreateError !== undefined) {
    saleCreate.mockRejectedValue(options.saleCreateError);
  }
  const receiptPrintCreate = vi
    .fn()
    .mockResolvedValue({ id: '99999999-9999-4999-8999-999999999999', printed_at: NOW });
  const receiptPrintCount = vi
    .fn()
    .mockResolvedValue(options.receiptPrintCount ?? 1);

  const tx = {
    shift: { findFirst: shiftFindFirst },
    $queryRaw: queryRaw,
    store: { update: storeUpdate },
    sale: { create: saleCreate },
    receiptPrint: {
      create: receiptPrintCreate,
      count: receiptPrintCount,
    },
  };

  const transaction = vi.fn().mockImplementation((argument) => {
    if (typeof argument === 'function') {
      return argument(tx);
    }
    return Promise.all(argument);
  });

  const idempotentRows = [...(options.idempotentRows ?? [null])];
  const saleFindUnique = vi.fn().mockImplementation(() => {
    if (idempotentRows.length > 1) {
      return Promise.resolve(idempotentRows.shift());
    }
    return Promise.resolve(idempotentRows[0] ?? null);
  });
  const saleFindFirst = vi
    .fn()
    .mockResolvedValue(options.detail ?? detailRow());
  const saleFindMany = vi.fn().mockResolvedValue(options.saleRows ?? [listRow()]);
  const saleCount = vi.fn().mockResolvedValue(options.totalSales ?? 1);
  const saleAggregate = vi.fn().mockResolvedValue(
    options.aggregate ?? {
      _count: { _all: 1 },
      _sum: { subtotal: 2_000, tax_total: 0, total: 2_000 },
    },
  );
  const paymentGroupBy = vi.fn().mockResolvedValue(
    options.groups ?? [
      { method: 'cash', _count: { _all: 1 }, _sum: { amount: 2_000 } },
    ],
  );
  const posAccountFindFirst = vi
    .fn()
    .mockResolvedValue(
      options.account === undefined
        ? { id: ACCOUNT_ID, label: 'Terminal 1' }
        : options.account,
    );
  const posAccountFindMany = vi
    .fn()
    .mockResolvedValue(options.accounts ?? []);
  const storeFindFirst = vi.fn().mockResolvedValue({
    name: 'Test Store',
    address: '1 Main Street',
    phone: '+2348012345678',
    currency: 'NGN',
    receipt_footer: 'Thank you',
    timezone: options.storeTimezone ?? 'Africa/Lagos',
  });
  const prismaQueryRaw = vi
    .fn()
    .mockResolvedValueOnce(options.dailyRows ?? [])
    .mockResolvedValueOnce(options.methodRows ?? []);

  const prisma = {
    $transaction: transaction,
    $queryRaw: prismaQueryRaw,
    sale: {
      findUnique: saleFindUnique,
      findFirst: saleFindFirst,
      findMany: saleFindMany,
      count: saleCount,
      aggregate: saleAggregate,
    },
    payment: { groupBy: paymentGroupBy },
    pOSAccount: {
      findFirst: posAccountFindFirst,
      findMany: posAccountFindMany,
    },
    store: { findFirst: storeFindFirst },
  } as unknown as PrismaService;

  const applyMovementInTx = vi.fn().mockResolvedValue({});
  if (options.movementError !== undefined) {
    let calls = 0;
    applyMovementInTx.mockImplementation(() => {
      calls += 1;
      if (calls >= 2) {
        return Promise.reject(options.movementError);
      }
      return Promise.resolve({});
    });
  }
  const auditRecord = vi.fn().mockResolvedValue(undefined);
  const clockDate = options.clockDate ?? new Date('2026-11-14T12:00:00.000Z');

  const service = new SalesService(
    prisma,
    { record: auditRecord } as unknown as AuditService,
    { applyMovementInTx } as unknown as StockService,
    { now: () => clockDate },
  );

  return {
    service,
    tx,
    transaction,
    shiftFindFirst,
    queryRaw,
    prismaQueryRaw,
    storeUpdate,
    saleCreate,
    saleFindUnique,
    saleFindFirst,
    saleFindMany,
    saleCount,
    saleAggregate,
    paymentGroupBy,
    posAccountFindFirst,
    posAccountFindMany,
    storeFindFirst,
    receiptPrintCreate,
    receiptPrintCount,
    applyMovementInTx,
    auditRecord,
  };
}

describe('SalesService.create', () => {
  it('writes the sale, payment, movements, receipt number and one audit row', async () => {
    const harness = createHarness();

    const result = await harness.service.create(PRINCIPAL, createDto());

    expect(result).toMatchObject({
      id: SALE_ID,
      receipt_number: 1,
      total: 2_000,
      payment_method: 'cash',
    });

    expect(harness.shiftFindFirst).toHaveBeenCalledWith({
      where: {
        store_id: STORE_ID,
        staff_id: STAFF_ID,
        clock_out_at: null,
      },
      select: { id: true },
      orderBy: { clock_in_at: 'desc' },
    });
    expect(harness.storeUpdate).toHaveBeenCalledWith({
      where: { id: STORE_ID },
      data: { sale_counter: { increment: 1 } },
      select: { sale_counter: true },
    });

    expect(harness.saleCreate).toHaveBeenCalledTimes(1);
    const saleData = harness.saleCreate.mock.calls[0][0].data as Record<
      string,
      any
    >;
    expect(saleData).toMatchObject({
      store_id: STORE_ID,
      receipt_number: 1,
      shift_id: SHIFT_ID,
      staff_id: STAFF_ID,
      subtotal: 2_000,
      tax_total: 0,
      total: 2_000,
      idempotency_key: null,
    });
    expect(saleData.items.create).toEqual([
      {
        item_id: ITEM_A,
        sku: 'SKU-A',
        name: 'Item A',
        unit: 'piece',
        unit_price: 1_000,
        quantity: 2,
        tax_amount: 0,
        line_total: 2_000,
      },
    ]);
    expect(saleData.payment.create).toEqual({
      method: 'cash',
      amount: 2_000,
      pos_account_id: null,
      account_label: null,
    });

    expect(harness.applyMovementInTx).toHaveBeenCalledTimes(1);
    const movementInput = harness.applyMovementInTx.mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(movementInput).toEqual({
      item_id: ITEM_A,
      quantity_change: -2,
      reason: 'sale',
      sale_id: SALE_ID,
    });
    expect(movementInput).not.toHaveProperty('audit_action');

    expect(harness.auditRecord).toHaveBeenCalledTimes(1);
    expect(harness.auditRecord.mock.calls[0][0]).toMatchObject({
      store_id: STORE_ID,
      staff_id: STAFF_ID,
      action: 'sale.created',
      entity_type: 'Sale',
      entity_id: SALE_ID,
      details: {
        receipt_number: 1,
        total: 2_000,
        payment_method: 'cash',
        shift_id: SHIFT_ID,
        lines: [
          {
            item_id: ITEM_A,
            sku: 'SKU-A',
            quantity: 2,
            unit_price: 1_000,
            line_total: 2_000,
          },
        ],
      },
    });
  });

  it('snapshots sku, name, unit and price from the locked item', async () => {
    const harness = createHarness({
      lockedItems: [
        lockedItem({
          sku: 'CANONICAL-SKU',
          name: 'Canonical Name',
          unit: 'bottle',
          current_price: 1_500,
        }),
      ],
    });

    await harness.service.create(
      PRINCIPAL,
      createDto({ expected_total: 3_000 }),
    );

    const saleData = harness.saleCreate.mock.calls[0][0].data as Record<
      string,
      any
    >;
    expect(saleData.items.create[0]).toEqual({
      item_id: ITEM_A,
      sku: 'CANONICAL-SKU',
      name: 'Canonical Name',
      unit: 'bottle',
      unit_price: 1_500,
      quantity: 2,
      tax_amount: 0,
      line_total: 3_000,
    });
  });

  it('merges duplicate item lines and locks each item once in sorted order', async () => {
    const harness = createHarness({
      lockedItems: [
        lockedItem({ id: ITEM_A, current_price: 1_000 }),
        lockedItem({ id: ITEM_B, current_price: 500 }),
      ],
    });

    await harness.service.create(
      PRINCIPAL,
      createDto({
        items: [
          { item_id: ITEM_B, quantity: 1 },
          { item_id: ITEM_A, quantity: 2 },
          { item_id: ITEM_B, quantity: 3 },
        ],
        expected_total: 4_000,
      }),
    );

    expect(harness.queryRaw).toHaveBeenCalledTimes(1);
    const sql = harness.queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(sql.values).toEqual([STORE_ID, ITEM_A, ITEM_B]);

    const saleData = harness.saleCreate.mock.calls[0][0].data as Record<
      string,
      any
    >;
    expect(saleData.items.create.map((line: { item_id: string }) => line.item_id)).toEqual([
      ITEM_A,
      ITEM_B,
    ]);
    expect(saleData.items.create[1].quantity).toBe(4);
    expect(harness.applyMovementInTx).toHaveBeenCalledTimes(2);
    expect(harness.applyMovementInTx.mock.calls[1][2]).toMatchObject({
      item_id: ITEM_B,
      quantity_change: -4,
    });
  });

  it('rejects a sale when the caller has no open shift', async () => {
    const harness = createHarness({ shift: null });

    await expect(
      harness.service.create(PRINCIPAL, createDto()),
    ).rejects.toMatchObject({ code: 'no_open_shift', status: 409 });

    expect(harness.queryRaw).not.toHaveBeenCalled();
    expect(harness.saleCreate).not.toHaveBeenCalled();
  });

  it('rejects missing, inactive and under-stocked items', async () => {
    const missing = createHarness({ lockedItems: [] });
    await expect(
      missing.service.create(PRINCIPAL, createDto()),
    ).rejects.toMatchObject({ code: 'item_not_found', status: 404 });

    const inactive = createHarness({
      lockedItems: [lockedItem({ active: false })],
    });
    await expect(
      inactive.service.create(PRINCIPAL, createDto()),
    ).rejects.toMatchObject({ code: 'item_inactive', status: 409 });

    const short = createHarness({
      lockedItems: [lockedItem({ stock_quantity: LOW_STOCK })],
    });
    await expect(
      short.service.create(PRINCIPAL, createDto()),
    ).rejects.toMatchObject({ code: 'insufficient_stock', status: 409 });
    expect(short.saleCreate).not.toHaveBeenCalled();
  });

  it('rejects totals that do not match or overflow', async () => {
    const mismatch = createHarness();
    await expect(
      mismatch.service.create(
        PRINCIPAL,
        createDto({ expected_total: 1_999 }),
      ),
    ).rejects.toMatchObject({ code: 'total_mismatch', status: 409 });

    const tooLarge = createHarness({
      lockedItems: [lockedItem({ current_price: 2_000_000_000 })],
    });
    await expect(
      tooLarge.service.create(
        PRINCIPAL,
        createDto({ expected_total: 4_000_000_000 }),
      ),
    ).rejects.toMatchObject({ code: 'sale_total_too_large', status: 400 });

    const unsafe = createHarness({
      lockedItems: [
        lockedItem({ current_price: Number.MAX_SAFE_INTEGER }),
      ],
    });
    await expect(
      unsafe.service.create(PRINCIPAL, createDto()),
    ).rejects.toMatchObject({ code: 'sale_total_too_large', status: 400 });
  });

  it('resolves card and bank accounts, rejecting missing or invalid ones', async () => {
    const card = createHarness();
    await card.service.create(
      PRINCIPAL,
      createDto({
        payment_method: 'card',
        pos_account_id: ACCOUNT_ID,
      }),
    );
    expect(card.posAccountFindFirst).toHaveBeenCalledWith({
      where: {
        id: ACCOUNT_ID,
        store_id: STORE_ID,
        type: 'pos_terminal',
        active: true,
      },
      select: { id: true, label: true },
    });
    const cardData = card.saleCreate.mock.calls[0][0].data as Record<
      string,
      any
    >;
    expect(cardData.payment.create).toMatchObject({
      method: 'card',
      pos_account_id: ACCOUNT_ID,
      account_label: 'Terminal 1',
    });

    const missing = createHarness();
    await expect(
      missing.service.create(
        PRINCIPAL,
        createDto({ payment_method: 'card' }),
      ),
    ).rejects.toMatchObject({
      code: 'payment_account_required',
      status: 400,
    });

    const notFound = createHarness({ account: null });
    await expect(
      notFound.service.create(
        PRINCIPAL,
        createDto({
          payment_method: 'bank_transfer',
          pos_account_id: ACCOUNT_ID,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'payment_account_not_found',
      status: 404,
    });

    const invalid = createHarness();
    await expect(
      invalid.service.create(
        PRINCIPAL,
        createDto({
          payment_method: 'cheque' as PaymentMethod,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_payment_method',
      status: 400,
    });
  });

  it('rejects cash with a POS account', async () => {
    const harness = createHarness();

    await expect(
      harness.service.create(
        PRINCIPAL,
        createDto({ pos_account_id: ACCOUNT_ID }),
      ),
    ).rejects.toMatchObject({
      code: 'payment_account_not_allowed',
      status: 400,
    });
  });

  it('propagates a late line failure without writing the audit row', async () => {
    const harness = createHarness({
      lockedItems: [
        lockedItem({ id: ITEM_A }),
        lockedItem({ id: ITEM_B }),
      ],
      movementError: new AppException(409, 'insufficient_stock', 'No stock'),
    });

    await expect(
      harness.service.create(
        PRINCIPAL,
        createDto({
          items: [
            { item_id: ITEM_A, quantity: 1 },
            { item_id: ITEM_B, quantity: 1 },
          ],
          expected_total: 2_000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'insufficient_stock' });

    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('replays a matching idempotency key without writing again', async () => {
    const harness = createHarness({
      idempotentRows: [{ id: SALE_ID, staff_id: STAFF_ID }],
    });

    const result = await harness.service.create(
      PRINCIPAL,
      createDto({ idempotency_key: 'idem-key-123' }),
    );

    expect(result.id).toBe(SALE_ID);
    expect(harness.saleFindUnique).toHaveBeenCalledWith({
      where: {
        store_id_idempotency_key: {
          store_id: STORE_ID,
          idempotency_key: 'idem-key-123',
        },
      },
      select: { id: true, staff_id: true },
    });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.saleCreate).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused by another staff member', async () => {
    const harness = createHarness({
      idempotentRows: [{ id: SALE_ID, staff_id: OTHER_STAFF_ID }],
    });

    await expect(
      harness.service.create(
        PRINCIPAL,
        createDto({ idempotency_key: 'idem-key-123' }),
      ),
    ).rejects.toMatchObject({
      code: 'idempotency_key_reused',
      status: 409,
    });
  });

  it('re-reads and replays after a concurrent idempotency key violation', async () => {
    const harness = createHarness({
      idempotentRows: [
        null,
        { id: SALE_ID, staff_id: STAFF_ID },
      ],
      saleCreateError: {
        code: 'P2002',
        meta: { target: ['store_id', 'idempotency_key'] },
      },
    });

    const result = await harness.service.create(
      PRINCIPAL,
      createDto({ idempotency_key: 'idem-key-123' }),
    );

    expect(result.id).toBe(SALE_ID);
    expect(harness.saleCreate).toHaveBeenCalledTimes(1);
    expect(harness.saleFindUnique).toHaveBeenCalledTimes(2);
  });

  it('replays when the driver adapter reports the constraint name instead of fields', async () => {
    const harness = createHarness({
      idempotentRows: [null, { id: SALE_ID, staff_id: STAFF_ID }],
      saleCreateError: {
        code: 'P2002',
        meta: {
          modelName: 'Sale',
          constraint: 'Sale_store_id_idempotency_key_key',
        },
      },
    });

    const result = await harness.service.create(
      PRINCIPAL,
      createDto({ idempotency_key: 'idem-key-123' }),
    );

    expect(result.id).toBe(SALE_ID);
    expect(harness.saleFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe('SalesService reads', () => {
  it('forces cashier history to the caller and applies every filter', async () => {
    const harness = createHarness();

    await harness.service.list(
      PRINCIPAL,
      listQuery({
        staff_id: OTHER_STAFF_ID,
        shift_id: SHIFT_ID,
        payment_method: 'card',
        q: '42',
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-08T00:00:00.000Z',
        page: 2,
        page_size: 10,
      }),
    );

    const expectedWhere = {
      store_id: STORE_ID,
      staff_id: STAFF_ID,
      shift_id: SHIFT_ID,
      receipt_number: 42,
      payment: { is: { method: 'card' } },
      created_at: {
        gte: new Date('2026-11-01T00:00:00.000Z'),
        lte: new Date('2026-11-08T00:00:00.000Z'),
      },
    };

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.saleFindMany).toHaveBeenCalledWith({
      where: expectedWhere,
      select: expect.any(Object),
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(harness.saleCount).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('lets managers filter by another staff member', async () => {
    const harness = createHarness();

    await harness.service.list(
      MANAGER,
      listQuery({ staff_id: OTHER_STAFF_ID }),
    );

    expect(harness.saleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: STORE_ID, staff_id: OTHER_STAFF_ID },
      }),
    );
  });

  it('returns 404, never 403, for another cashier sale', async () => {
    const harness = createHarness();
    harness.saleFindFirst.mockResolvedValueOnce(null);

    await expect(
      harness.service.findOne(PRINCIPAL, SALE_ID),
    ).rejects.toMatchObject({ code: 'sale_not_found', status: 404 });

    expect(harness.saleFindFirst).toHaveBeenCalledWith({
      where: { id: SALE_ID, store_id: STORE_ID, staff_id: STAFF_ID },
      select: expect.any(Object),
    });
  });

  it('lists payment options grouped in memory and hides empty methods', async () => {
    const both = createHarness({
      accounts: [
        { id: 't1', label: 'Front POS', type: 'pos_terminal' },
        { id: 'b1', label: 'Bank', type: 'bank_account' },
      ],
    });
    const bothOptions = await both.service.paymentOptions(PRINCIPAL);
    expect(both.posAccountFindMany).toHaveBeenCalledWith({
      where: { store_id: STORE_ID, active: true },
      select: { id: true, label: true, type: true },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });
    expect(bothOptions).toEqual({
      cash: { method: 'cash', accounts: [] },
      card: { method: 'card', accounts: [{ id: 't1', label: 'Front POS' }] },
      bank_transfer: {
        method: 'bank_transfer',
        accounts: [{ id: 'b1', label: 'Bank' }],
      },
    });

    const cashOnly = createHarness({ accounts: [] });
    expect(await cashOnly.service.paymentOptions(PRINCIPAL)).toEqual({
      cash: { method: 'cash', accounts: [] },
    });

    const cardOnly = createHarness({
      accounts: [{ id: 't1', label: 'Front POS', type: 'pos_terminal' }],
    });
    const cardOptions = await cardOnly.service.paymentOptions(PRINCIPAL);
    expect(cardOptions.card).toBeDefined();
    expect(cardOptions.bank_transfer).toBeUndefined();
  });

  it('summarises sales and payments with the same store scope', async () => {
    const harness = createHarness({
      aggregate: {
        _count: { _all: 3 },
        _sum: { subtotal: 10_000, tax_total: 0, total: 10_000 },
      },
      groups: [
        { method: 'card', _count: { _all: 1 }, _sum: { amount: 3_000 } },
        { method: 'cash', _count: { _all: 2 }, _sum: { amount: 7_000 } },
      ],
    });

    const summary = await harness.service.summary(
      PRINCIPAL,
      listQuery({
        shift_id: SHIFT_ID,
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-08T00:00:00.000Z',
      }),
    );

    const expectedWhere = {
      store_id: STORE_ID,
      staff_id: STAFF_ID,
      shift_id: SHIFT_ID,
      created_at: {
        gte: new Date('2026-11-01T00:00:00.000Z'),
        lte: new Date('2026-11-08T00:00:00.000Z'),
      },
    };

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.saleAggregate).toHaveBeenCalledWith({
      where: expectedWhere,
      _count: { _all: true },
      _sum: { subtotal: true, tax_total: true, total: true },
    });
    expect(harness.paymentGroupBy).toHaveBeenCalledWith({
      by: ['method'],
      where: { sale: { is: expectedWhere } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    expect(summary).toEqual({
      sale_count: 3,
      subtotal: 10_000,
      tax_total: 0,
      total: 10_000,
      by_payment_method: [
        { method: 'card', count: 1, amount: 3_000 },
        { method: 'cash', count: 2, amount: 7_000 },
      ],
    });
  });
});

describe('SalesService.overview', () => {
  it('returns seven oldest-first days, fills gaps and maps today by method', async () => {
    const harness = createHarness({
      clockDate: new Date('2026-11-14T12:00:00.000Z'),
      storeTimezone: 'Africa/Lagos',
      dailyRows: [
        { day: '2026-11-12', total: '4500', count: 2 },
        { day: '2026-11-14', total: '7000', count: 3 },
      ],
      methodRows: [
        { method: 'card', total: '2000', count: 1 },
        { method: 'cash', total: '5000', count: 2 },
      ],
    });

    const result = await harness.service.overview(MANAGER);

    expect(harness.storeFindFirst).toHaveBeenCalledWith({
      where: { id: STORE_ID },
      select: { timezone: true },
    });
    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.prismaQueryRaw).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      timezone: 'Africa/Lagos',
      scope: 'store',
      today: {
        date: '2026-11-14',
        total: 7000,
        count: 3,
        by_method: [
          { method: 'card', total: 2000, count: 1 },
          { method: 'cash', total: 5000, count: 2 },
        ],
      },
      daily: [
        { date: '2026-11-08', total: 0, count: 0 },
        { date: '2026-11-09', total: 0, count: 0 },
        { date: '2026-11-10', total: 0, count: 0 },
        { date: '2026-11-11', total: 0, count: 0 },
        { date: '2026-11-12', total: 4500, count: 2 },
        { date: '2026-11-13', total: 0, count: 0 },
        { date: '2026-11-14', total: 7000, count: 3 },
      ],
    });
  });

  it('scopes cashiers to their own sales and managers to the store', async () => {
    const cashier = createHarness();
    const cashierResult = await cashier.service.overview(PRINCIPAL);

    expect(cashierResult.scope).toBe('own');
    const cashierDailySql = cashier.prismaQueryRaw.mock.calls[0][0] as {
      values: unknown[];
    };
    expect(cashierDailySql.values).toEqual(
      expect.arrayContaining([STORE_ID, STAFF_ID]),
    );

    const manager = createHarness();
    const managerResult = await manager.service.overview(MANAGER);

    expect(managerResult.scope).toBe('store');
    const managerDailySql = manager.prismaQueryRaw.mock.calls[0][0] as {
      values: unknown[];
    };
    expect(managerDailySql.values).not.toContain(STAFF_ID);
  });
});

describe('SalesService.printReceipt', () => {
  it('marks the first print as an original and does not audit it', async () => {
    const harness = createHarness({ receiptPrintCount: 1 });

    const receipt = await harness.service.printReceipt(PRINCIPAL, SALE_ID);

    expect(receipt.is_copy).toBe(false);
    expect(receipt.print_number).toBe(1);
    expect(receipt.sale.id).toBe(SALE_ID);
    expect(receipt.store).toMatchObject({
      name: 'Test Store',
      currency: 'NGN',
    });
    expect(harness.receiptPrintCreate).toHaveBeenCalledWith({
      data: { sale_id: SALE_ID, staff_id: STAFF_ID },
      select: { id: true, printed_at: true },
    });
    expect(harness.receiptPrintCount).toHaveBeenCalledWith({
      where: { sale_id: SALE_ID },
    });
    expect(harness.auditRecord).not.toHaveBeenCalled();
  });

  it('marks reprints as copies and audits only those', async () => {
    const harness = createHarness({ receiptPrintCount: 2 });

    const receipt = await harness.service.printReceipt(PRINCIPAL, SALE_ID);

    expect(receipt.is_copy).toBe(true);
    expect(receipt.print_number).toBe(2);
    expect(harness.auditRecord).toHaveBeenCalledTimes(1);
    expect(harness.auditRecord.mock.calls[0][0]).toMatchObject({
      store_id: STORE_ID,
      staff_id: STAFF_ID,
      action: 'sale.receipt_reprinted',
      entity_type: 'Sale',
      entity_id: SALE_ID,
      details: { receipt_number: 1, print_number: 2 },
    });
  });
});
