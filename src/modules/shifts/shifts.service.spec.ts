import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../common/clock.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { ShiftsService } from './shifts.service.js';

const PRINCIPAL = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'manager' as const,
  timezone: 'Africa/Lagos',
};

const STAFF_ID = '33333333-3333-4333-8333-333333333333';

const SHIFT = {
  id: '44444444-4444-4444-8444-444444444444',
  store_id: PRINCIPAL.store_id,
  staff_id: STAFF_ID,
  clock_in_at: new Date('2026-10-25T12:00:00.000Z'),
  clock_out_at: new Date('2026-10-25T18:00:00.000Z'),
  opening_float: 1_000,
  closing_cash_counted: 1_200,
  opening_notes: null,
  closing_notes: null,
  closed_by_staff_id: STAFF_ID,
  close_reason: 'normal' as const,
  created_at: new Date('2026-10-25T12:00:00.000Z'),
  updated_at: new Date('2026-10-25T18:00:00.000Z'),
};

function createService(total = 1) {
  const findMany = vi.fn().mockResolvedValue([SHIFT]);
  const count = vi.fn().mockResolvedValue(total);
  const transaction = vi
    .fn()
    .mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  const findStore = vi.fn();
  const prisma = {
    shift: { findMany, count },
    store: { findUnique: findStore },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new ShiftsService(prisma, {} as AuditService, {} as Clock);

  return { service, findMany, count, transaction, findStore };
}

describe('ShiftsService.list', () => {
  it('runs two scoped queries and returns page metadata', async () => {
    const { service, findMany, count, transaction, findStore } =
      createService(42);

    const result = await service.list(PRINCIPAL, {
      page: 2,
      page_size: 10,
      staff_id: STAFF_ID,
    });

    const expectedWhere = {
      store_id: PRINCIPAL.store_id,
      staff_id: STAFF_ID,
    };

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ clock_in_at: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(findStore).not.toHaveBeenCalled();
    expect(result.meta).toEqual({
      page: 2,
      page_size: 10,
      total: 42,
      total_pages: 5,
    });
    expect(result.data).toHaveLength(1);
  });

  it('uses the principal timezone for date filters without another query', async () => {
    const { service, findMany, transaction, findStore } = createService();

    await service.list(PRINCIPAL, {
      from: '2026-10-25',
      to: '2026-10-25',
      page: 1,
      page_size: 25,
    });

    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          store_id: PRINCIPAL.store_id,
          clock_in_at: {
            gte: new Date('2026-10-24T23:00:00.000Z'),
            lt: new Date('2026-10-25T23:00:00.000Z'),
          },
        },
      }),
    );
    expect(findStore).not.toHaveBeenCalled();
  });
});
