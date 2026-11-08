import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '../src/generated/prisma/enums.js';
import { AUDIT_ACTIONS } from '../src/modules/audit/audit-actions.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  loginAs,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const DETAILED_STORE = {
  address: '1 Main Street',
  phone: '+2348030000000',
  receipt_footer: 'Thank you for your custom',
};

describe('Sales (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let cashierId: string;
  let managerId: string;
  let adminId: string;
  let shiftId: string;
  let tokens: Record<StaffRole, string>;
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
    storeId = (
      await createStore(context.prisma, {
        name: 'Test Store',
        currency: 'NGN',
        timezone: 'Africa/Lagos',
      })
    ).id;
    await context.prisma.store.update({
      where: { id: storeId },
      data: DETAILED_STORE,
    });

    const cashier = await createStaff(context, storeId, {
      staffCode: 'CASHIER',
      role: 'cashier',
      first_name: 'Ada',
      last_name: 'Okafor',
    });
    const manager = await createStaff(context, storeId, {
      staffCode: 'MANAGER',
      role: 'manager',
    });
    const admin = await createStaff(context, storeId, {
      staffCode: 'ADMIN',
      role: 'admin',
    });
    cashierId = cashier.id;
    managerId = manager.id;
    adminId = admin.id;

    tokens = {
      cashier: (await loginAs(context, 'CASHIER')).token,
      manager: (await loginAs(context, 'MANAGER')).token,
      admin: (await loginAs(context, 'ADMIN')).token,
    };

    shiftId = (
      await context.prisma.shift.create({
        data: {
          store_id: storeId,
          staff_id: cashierId,
          clock_in_at: new Date('2026-11-08T09:00:00.000Z'),
        },
      })
    ).id;
  });

  async function openShift(staffId: string, targetStoreId = storeId) {
    return context.prisma.shift.create({
      data: {
        store_id: targetStoreId,
        staff_id: staffId,
        clock_in_at: new Date('2026-11-08T09:00:00.000Z'),
      },
    });
  }

  async function createItem(
    overrides: Partial<{
      storeId: string;
      price: number;
      stock: number;
      active: boolean;
      unit: string;
    }> = {},
  ) {
    itemSequence += 1;
    const itemStoreId = overrides.storeId ?? storeId;
    const item = await context.prisma.item.create({
      data: {
        store_id: itemStoreId,
        sku: `SKU-${itemSequence}`,
        name: `Item ${itemSequence}`,
        unit: overrides.unit ?? 'piece',
        current_price: overrides.price ?? 1_000,
        cost_price: 500,
        stock_quantity: overrides.stock ?? 10,
        active: overrides.active ?? true,
      },
    });

    // Keep the movement ledger balanced so reconciliation stays meaningful.
    if (item.stock_quantity > 0) {
      await context.prisma.stockMovement.create({
        data: {
          store_id: itemStoreId,
          item_id: item.id,
          quantity_change: item.stock_quantity,
          reason: 'initial',
          staff_id: managerId,
        },
      });
    }

    return item;
  }

  async function createAccount(
    type: 'pos_terminal' | 'bank_account',
    overrides: Partial<{ label: string; active: boolean; storeId: string }> = {},
  ) {
    return context.prisma.pOSAccount.create({
      data: {
        store_id: overrides.storeId ?? storeId,
        label: overrides.label ?? `${type} account`,
        type,
        active: overrides.active ?? true,
      },
    });
  }

  function postSale(body: Record<string, unknown>, token = tokens.cashier) {
    return request(server()).post('/api/v1/sales').set(bearer(token)).send(body);
  }

  function cashSale(
    itemId: string,
    quantity: number,
    expectedTotal: number,
    extra: Record<string, unknown> = {},
    token = tokens.cashier,
  ) {
    return postSale(
      {
        items: [{ item_id: itemId, quantity }],
        payment_method: 'cash',
        expected_total: expectedTotal,
        ...extra,
      },
      token,
    );
  }

  it('records a sale, snapshots its lines and moves stock atomically', async () => {
    const itemA = await createItem({ price: 1_000, stock: 10 });
    const itemB = await createItem({ price: 250, stock: 5, unit: 'bottle' });

    const response = await postSale({
      items: [
        { item_id: itemB.id, quantity: 1 },
        { item_id: itemA.id, quantity: 2 },
      ],
      payment_method: 'cash',
      expected_total: 2_250,
    }).expect(201);

    expect(response.body).toMatchObject({
      store_id: storeId,
      receipt_number: 1,
      shift_id: shiftId,
      staff_id: cashierId,
      staff_name: 'Ada Okafor',
      subtotal: 2_250,
      tax_total: 0,
      total: 2_250,
      payment_method: 'cash',
      item_count: 2,
      payment: {
        method: 'cash',
        amount: 2_250,
        pos_account_id: null,
        account_label: null,
      },
    });

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_id: itemA.id,
          sku: itemA.sku,
          name: itemA.name,
          unit: 'piece',
          unit_price: 1_000,
          quantity: 2,
          tax_amount: 0,
          line_total: 2_000,
        }),
        expect.objectContaining({
          item_id: itemB.id,
          sku: itemB.sku,
          name: itemB.name,
          unit: 'bottle',
          unit_price: 250,
          quantity: 1,
          tax_amount: 0,
          line_total: 250,
        }),
      ]),
    );

    const [storedA, storedB, storedStore] = await Promise.all([
      context.prisma.item.findUniqueOrThrow({ where: { id: itemA.id } }),
      context.prisma.item.findUniqueOrThrow({ where: { id: itemB.id } }),
      context.prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
    ]);
    expect(storedA.stock_quantity).toBe(8);
    expect(storedB.stock_quantity).toBe(4);
    expect(storedStore.sale_counter).toBe(1);

    const movements = await context.prisma.stockMovement.findMany({
      where: { sale_id: response.body.id },
      orderBy: { item_id: 'asc' },
    });
    expect(movements).toHaveLength(2);
    for (const movement of movements) {
      expect(movement).toMatchObject({
        store_id: storeId,
        reason: 'sale',
        staff_id: cashierId,
        sale_id: response.body.id,
      });
    }

    const audits = await context.prisma.auditLog.findMany({
      where: {
        store_id: storeId,
        action: AUDIT_ACTIONS.saleCreated,
        entity_id: response.body.id,
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      staff_id: cashierId,
      entity_type: 'Sale',
    });
    expect(audits[0].details).toMatchObject({
      receipt_number: 1,
      total: 2_250,
      payment_method: 'cash',
      shift_id: shiftId,
    });
    expect(audits[0].details).not.toHaveProperty('pin_hash');

    const fetched = await request(server())
      .get(`/api/v1/sales/${response.body.id}`)
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(fetched.body).toEqual(response.body);
  });

  it('rejects invalid carts, stale totals and unusable payment accounts', async () => {
    const item = await createItem({ price: 1_000, stock: 2 });
    const inactiveItem = await createItem({ active: false });
    const inactiveTerminal = await createAccount('pos_terminal', {
      label: 'Offline terminal',
      active: false,
    });
    const bankAccount = await createAccount('bank_account', {
      label: 'GTBank',
    });
    const otherStore = await createStore(context.prisma, {
      name: 'Other',
      active: false,
    });
    const foreignItem = await createItem({ storeId: otherStore.id });

    await createStaff(context, storeId, {
      staffCode: 'NOSHIFT',
      role: 'cashier',
    });
    const noShiftToken = (await loginAs(context, 'NOSHIFT')).token;

    await cashSale(item.id, 1, 1_000, {}, noShiftToken)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('no_open_shift');
      });

    for (const body of [
      { items: [], payment_method: 'cash', expected_total: 0 },
      {
        items: [{ item_id: item.id, quantity: 0 }],
        payment_method: 'cash',
        expected_total: 0,
      },
      {
        items: [{ item_id: item.id, quantity: 1.5 }],
        payment_method: 'cash',
        expected_total: 1_500,
      },
      {
        items: [{ item_id: item.id, quantity: 1 }],
        payment_method: 'cheque',
        expected_total: 1_000,
      },
      {
        items: [{ item_id: item.id, quantity: 1 }],
        payment_method: 'cash',
        expected_total: 1_000.5,
      },
    ]) {
      await postSale(body, noShiftToken).expect(400);
    }

    await cashSale(item.id, 1, 999)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('total_mismatch');
      });

    await postSale({
      items: [{ item_id: item.id, quantity: 1 }],
      payment_method: 'cash',
      expected_total: 1_000,
      pos_account_id: bankAccount.id,
    })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('payment_account_not_allowed');
      });

    await postSale({
      items: [{ item_id: item.id, quantity: 1 }],
      payment_method: 'card',
      expected_total: 1_000,
    })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('payment_account_required');
      });

    for (const accountId of [bankAccount.id, inactiveTerminal.id]) {
      await postSale({
        items: [{ item_id: item.id, quantity: 1 }],
        payment_method: 'card',
        pos_account_id: accountId,
        expected_total: 1_000,
      })
        .expect(404)
        .expect((response) => {
          expect(response.body.code).toBe('payment_account_not_found');
        });
    }

    await cashSale(foreignItem.id, 1, 1_000)
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('item_not_found');
      });

    await cashSale(inactiveItem.id, 1, 1_000)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('item_inactive');
      });

    await cashSale(item.id, 3, 3_000)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('insufficient_stock');
      });

    expect(await context.prisma.sale.count()).toBe(0);
    const stored = await context.prisma.item.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored.stock_quantity).toBe(2);
  });

  it('uses configured payment accounts and exposes them as payment options', async () => {
    const terminal = await createAccount('pos_terminal', {
      label: 'Terminal 1',
    });
    const bank = await createAccount('bank_account', { label: 'GTBank' });
    await createAccount('pos_terminal', {
      label: 'Offline terminal',
      active: false,
    });
    const otherStore = await createStore(context.prisma, { name: 'Other' });
    await createAccount('bank_account', {
      label: 'Foreign bank',
      storeId: otherStore.id,
    });

    const options = await request(server())
      .get('/api/v1/sales/payment-options')
      .set(bearer(tokens.cashier))
      .expect(200);

    expect(options.body).toEqual({
      cash: { method: 'cash', accounts: [] },
      card: {
        method: 'card',
        accounts: [{ id: terminal.id, label: 'Terminal 1' }],
      },
      bank_transfer: {
        method: 'bank_transfer',
        accounts: [{ id: bank.id, label: 'GTBank' }],
      },
    });

    const item = await createItem({ price: 1_250, stock: 5 });
    const cardSale = await postSale({
      items: [{ item_id: item.id, quantity: 2 }],
      payment_method: 'card',
      pos_account_id: terminal.id,
      expected_total: 2_500,
    }).expect(201);

    expect(cardSale.body.payment).toMatchObject({
      method: 'card',
      amount: 2_500,
      pos_account_id: terminal.id,
      account_label: 'Terminal 1',
    });

    const bankSale = await postSale({
      items: [{ item_id: item.id, quantity: 1 }],
      payment_method: 'bank_transfer',
      pos_account_id: bank.id,
      expected_total: 1_250,
    }).expect(201);
    expect(bankSale.body.payment).toMatchObject({
      method: 'bank_transfer',
      pos_account_id: bank.id,
      account_label: 'GTBank',
    });

    const filtered = await request(server())
      .get('/api/v1/sales?payment_method=card')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(filtered.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      cardSale.body.id,
    ]);
  });

  it('replays an idempotent sale exactly once under concurrency', async () => {
    const item = await createItem({ price: 1_000, stock: 5 });
    const key = 'sale-idempotency-key-1';

    const responses = await Promise.all([
      cashSale(item.id, 2, 2_000, { idempotency_key: key }),
      cashSale(item.id, 2, 2_000, { idempotency_key: key }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);

    expect(await context.prisma.sale.count()).toBe(1);
    expect(
      (
        await context.prisma.item.findUniqueOrThrow({ where: { id: item.id } })
      ).stock_quantity,
    ).toBe(3);
    expect(
      await context.prisma.stockMovement.count({
        where: { reason: 'sale', item_id: item.id },
      }),
    ).toBe(1);
    expect(
      await context.prisma.auditLog.count({
        where: { action: AUDIT_ACTIONS.saleCreated },
      }),
    ).toBe(1);
    expect(
      (await context.prisma.store.findUniqueOrThrow({ where: { id: storeId } }))
        .sale_counter,
    ).toBe(1);

    const replay = await cashSale(item.id, 1, 1_000, {
      idempotency_key: key,
    }).expect(201);
    expect(replay.body.id).toBe(responses[0].body.id);
    expect(replay.body.total).toBe(2_000);

    await createStaff(context, storeId, {
      staffCode: 'CASHIER2',
      role: 'cashier',
    });
    const otherToken = (await loginAs(context, 'CASHIER2')).token;
    await openShift((await loginAs(context, 'CASHIER2')).staffId);

    await cashSale(item.id, 1, 1_000, { idempotency_key: key }, otherToken)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('idempotency_key_reused');
      });

    expect(await context.prisma.sale.count()).toBe(1);
  });

  it('never oversells the last unit under concurrent sales', async () => {
    const item = await createItem({ price: 1_000, stock: 1 });

    const responses = await Promise.all([
      cashSale(item.id, 1, 1_000),
      cashSale(item.id, 1, 1_000),
    ]);

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected?.body.code).toBe('insufficient_stock');

    expect(await context.prisma.sale.count()).toBe(1);
    expect(
      (
        await context.prisma.item.findUniqueOrThrow({ where: { id: item.id } })
      ).stock_quantity,
    ).toBe(0);
    expect(
      await context.prisma.stockMovement.count({
        where: { reason: 'sale', item_id: item.id },
      }),
    ).toBe(1);
  });

  it('prints a receipt once and records only reprints in the audit trail', async () => {
    const item = await createItem({ price: 1_000, stock: 5 });
    const sale = await cashSale(item.id, 1, 1_000).expect(201);

    const first = await request(server())
      .post(`/api/v1/sales/${sale.body.id}/receipt-prints`)
      .set(bearer(tokens.cashier))
      .expect(200);

    expect(first.body).toMatchObject({
      print_number: 1,
      is_copy: false,
      sale: { id: sale.body.id, receipt_number: 1, total: 1_000 },
      store: {
        name: 'Test Store',
        address: DETAILED_STORE.address,
        phone: DETAILED_STORE.phone,
        currency: 'NGN',
        receipt_footer: DETAILED_STORE.receipt_footer,
      },
    });
    expect(first.body.id).toBeTypeOf('string');
    expect(new Date(first.body.printed_at).toISOString()).toBe(
      first.body.printed_at,
    );

    const second = await request(server())
      .post(`/api/v1/sales/${sale.body.id}/receipt-prints`)
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(second.body).toMatchObject({
      print_number: 2,
      is_copy: true,
      sale: { id: sale.body.id },
    });

    expect(
      await context.prisma.receiptPrint.count({
        where: { sale_id: sale.body.id },
      }),
    ).toBe(2);
    const reprints = await context.prisma.auditLog.findMany({
      where: {
        action: AUDIT_ACTIONS.saleReceiptReprinted,
        entity_id: sale.body.id,
      },
    });
    expect(reprints).toHaveLength(1);
    expect(reprints[0].details).toMatchObject({
      receipt_number: 1,
      print_number: 2,
    });

    await createStaff(context, storeId, {
      staffCode: 'CASHIER2',
      role: 'cashier',
    });
    const otherToken = (await loginAs(context, 'CASHIER2')).token;

    await request(server())
      .get(`/api/v1/sales/${sale.body.id}`)
      .set(bearer(otherToken))
      .expect(404);
    await request(server())
      .post(`/api/v1/sales/${sale.body.id}/receipt-prints`)
      .set(bearer(otherToken))
      .expect(404);
  });

  it('scopes lists and summaries by store and cashier, with filters and paging', async () => {
    const itemA = await createItem({ price: 1_000 });
    const itemB = await createItem({ price: 500 });

    const cashierOneSale = await cashSale(itemA.id, 1, 1_000).expect(201);

    const cashierTwo = await createStaff(context, storeId, {
      staffCode: 'CASHIER2',
      role: 'cashier',
    });
    const cashierTwoToken = (await loginAs(context, 'CASHIER2')).token;
    await openShift(cashierTwo.id);
    const cashierTwoSale = await cashSale(
      itemB.id,
      2,
      1_000,
      {},
      cashierTwoToken,
    ).expect(201);

    const otherStore = await createStore(context.prisma, {
      name: 'Other',
      active: false,
    });
    const foreignCashier = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
      role: 'cashier',
    });
    const foreignShift = await openShift(foreignCashier.id, otherStore.id);
    const foreignSale = await context.prisma.sale.create({
      data: {
        store_id: otherStore.id,
        receipt_number: 1,
        shift_id: foreignShift.id,
        staff_id: foreignCashier.id,
        subtotal: 9_000,
        total: 9_000,
      },
    });

    const own = await request(server())
      .get('/api/v1/sales')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(own.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      cashierOneSale.body.id,
    ]);
    expect(own.body.meta).toEqual({
      page: 1,
      page_size: 25,
      total: 1,
      total_pages: 1,
    });

    const all = await request(server())
      .get('/api/v1/sales')
      .set(bearer(tokens.manager))
      .expect(200);
    expect(new Set(all.body.data.map((sale: { id: string }) => sale.id))).toEqual(
      new Set([cashierOneSale.body.id, cashierTwoSale.body.id]),
    );
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0]).not.toHaveProperty('items');

    const byStaff = await request(server())
      .get(`/api/v1/sales?staff_id=${cashierTwo.id}`)
      .set(bearer(tokens.manager))
      .expect(200);
    expect(byStaff.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      cashierTwoSale.body.id,
    ]);

    const byReceipt = await request(server())
      .get('/api/v1/sales?q=2')
      .set(bearer(tokens.manager))
      .expect(200);
    expect(byReceipt.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      cashierTwoSale.body.id,
    ]);

    const byShift = await request(server())
      .get(`/api/v1/sales?shift_id=${shiftId}`)
      .set(bearer(tokens.manager))
      .expect(200);
    expect(byShift.body.data.map((sale: { id: string }) => sale.id)).toEqual([
      cashierOneSale.body.id,
    ]);

    const pageOne = await request(server())
      .get('/api/v1/sales?page=1&page_size=1')
      .set(bearer(tokens.manager))
      .expect(200);
    const pageTwo = await request(server())
      .get('/api/v1/sales?page=2&page_size=1')
      .set(bearer(tokens.manager))
      .expect(200);
    expect(pageOne.body.meta).toEqual({
      page: 1,
      page_size: 1,
      total: 2,
      total_pages: 2,
    });
    expect(
      new Set([
        ...pageOne.body.data.map((sale: { id: string }) => sale.id),
        ...pageTwo.body.data.map((sale: { id: string }) => sale.id),
      ]),
    ).toEqual(
      new Set([cashierOneSale.body.id, cashierTwoSale.body.id]),
    );

    await request(server())
      .get('/api/v1/sales?from=2026-13-01T00:00:00.000Z')
      .set(bearer(tokens.manager))
      .expect(400);
    await request(server())
      .get(
        '/api/v1/sales?from=2026-11-09T00:00:00.000Z&to=2026-11-08T00:00:00.000Z',
      )
      .set(bearer(tokens.manager))
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('invalid_date_range');
      });

    const ownSummary = await request(server())
      .get('/api/v1/sales/summary')
      .set(bearer(tokens.cashier))
      .expect(200);
    expect(ownSummary.body).toEqual({
      sale_count: 1,
      subtotal: 1_000,
      tax_total: 0,
      total: 1_000,
      by_payment_method: [{ method: 'cash', count: 1, amount: 1_000 }],
    });

    const allSummary = await request(server())
      .get(
        '/api/v1/sales/summary?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z',
      )
      .set(bearer(tokens.manager))
      .expect(200);
    expect(allSummary.body).toEqual({
      sale_count: 2,
      subtotal: 2_000,
      tax_total: 0,
      total: 2_000,
      by_payment_method: [{ method: 'cash', count: 2, amount: 2_000 }],
    });

    expect(foreignSale.id).toBeTypeOf('string');
    expect(
      await context.prisma.sale.count({ where: { store_id: otherStore.id } }),
    ).toBe(1);
  });

  it('treats sales and items from another store as not found', async () => {
    const otherStore = await createStore(context.prisma, {
      name: 'Other',
      active: false,
    });
    const foreignCashier = await createStaff(context, otherStore.id, {
      staffCode: 'FOREIGN',
      role: 'cashier',
    });
    const foreignShift = await openShift(foreignCashier.id, otherStore.id);
    const foreignItem = await createItem({
      storeId: otherStore.id,
      price: 2_000,
    });
    const foreignSale = await context.prisma.sale.create({
      data: {
        store_id: otherStore.id,
        receipt_number: 1,
        shift_id: foreignShift.id,
        staff_id: foreignCashier.id,
        subtotal: 2_000,
        total: 2_000,
      },
    });

    await request(server())
      .get(`/api/v1/sales/${foreignSale.id}`)
      .set(bearer(tokens.manager))
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('sale_not_found');
      });

    const ownList = await request(server())
      .get('/api/v1/sales')
      .set(bearer(tokens.manager))
      .expect(200);
    expect(ownList.body.data).toEqual([]);
    expect(ownList.body.meta.total).toBe(0);

    await cashSale(foreignItem.id, 1, 2_000)
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('item_not_found');
      });
  });

  it('keeps the movement reconciliation clean after a sale', async () => {
    const item = await createItem({ price: 1_000, stock: 5 });
    await cashSale(item.id, 2, 2_000).expect(201);

    const reconciliation = await request(server())
      .get('/api/v1/inventory/reconciliation')
      .set(bearer(tokens.admin))
      .expect(200);

    expect(reconciliation.body.data).toEqual([]);
    expect(reconciliation.body.meta.total).toBe(0);
  });

  it('rejects raw mutations of completed sales and their financial rows', async () => {
    const item = await createItem({ price: 1_000 });
    const sale = await cashSale(item.id, 1, 1_000).expect(201);

    const mutations: Array<[string, string]> = [
      ['UPDATE "Sale" SET "total" = "total" + 1 WHERE "id" = $1', sale.body.id],
      ['DELETE FROM "Sale" WHERE "id" = $1', sale.body.id],
      ['UPDATE "SaleItem" SET "quantity" = 2 WHERE "sale_id" = $1', sale.body.id],
      ['DELETE FROM "SaleItem" WHERE "sale_id" = $1', sale.body.id],
      ['UPDATE "Payment" SET "amount" = 1 WHERE "sale_id" = $1', sale.body.id],
      ['DELETE FROM "Payment" WHERE "sale_id" = $1', sale.body.id],
    ];

    for (const [sql, id] of mutations) {
      await expect(
        context.prisma.$executeRawUnsafe(sql, id),
      ).rejects.toThrow(/immutable/);
    }

    expect(
      await context.prisma.sale.count({ where: { id: sale.body.id } }),
    ).toBe(1);
  });

  it('requires authentication and exposes the sales API in Swagger', async () => {
    await request(server()).get('/api/v1/sales').expect(401);

    const response = await request(server()).get('/docs-json').expect(200);
    const paths = response.body.paths;

    expect(paths['/api/v1/sales'].post).toBeDefined();
    expect(paths['/api/v1/sales'].get).toBeDefined();
    expect(paths['/api/v1/sales/payment-options'].get).toBeDefined();
    expect(paths['/api/v1/sales/summary'].get).toBeDefined();
    expect(paths['/api/v1/sales/{id}'].get).toBeDefined();
    expect(paths['/api/v1/sales/{id}/receipt-prints'].post).toBeDefined();

    const schemas = response.body.components.schemas;
    for (const name of [
      'CreateSaleDto',
      'CreateSaleItemDto',
      'SaleItemResponseDto',
      'SaleListItemDto',
      'SaleResponseDto',
      'SalePaymentResponseDto',
      'PaymentOptionsResponseDto',
      'PaymentMethodOptionDto',
      'SalesSummaryResponseDto',
      'ReceiptResponseDto',
      'ReceiptStoreDto',
    ]) {
      expect(schemas[name], `${name} schema missing`).toBeDefined();
    }

    expect(
      schemas.CreateSaleDto.properties.payment_method,
    ).toMatchObject({
      type: 'string',
      enum: expect.arrayContaining(['cash', 'card', 'bank_transfer']),
    });
    const listOperation = paths['/api/v1/sales'].get;
    const listSchema =
      listOperation.responses['200'].content?.['application/json']?.schema;
    expect(listSchema?.properties?.data?.type).toBe('array');
    expect(listSchema?.properties?.meta?.$ref).toContain('PageMetaDto');

    expect(managerId).toBeTypeOf('string');
    expect(adminId).toBeTypeOf('string');
  });
});
