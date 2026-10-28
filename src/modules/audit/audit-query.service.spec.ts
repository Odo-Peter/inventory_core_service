import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { AuditQueryService } from './audit-query.service.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

const PRINCIPAL = {
  staff_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  role: 'admin' as const,
};

const LOG = {
  id: '33333333-3333-4333-8333-333333333333',
  created_at: new Date('2026-10-25T12:00:00.000Z'),
  action: AUDIT_ACTIONS.staffUpdated,
  entity_type: 'Staff',
  entity_id: '11111111-1111-4111-8111-111111111111',
  details: { email: 'ada@example.com', fields: ['first_name'] },
  staff: {
    id: '11111111-1111-4111-8111-111111111111',
    first_name: 'Ada',
    last_name: 'Okafor',
    staff_code: 'CASH001',
    role: 'cashier' as const,
  },
};

function createService(
  logs: unknown[] = [LOG],
  total = logs.length,
): {
  service: AuditQueryService;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(logs);
  const count = vi.fn().mockResolvedValue(total);
  const transaction = vi
    .fn()
    .mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  const prisma = {
    auditLog: { findMany, count },
    $transaction: transaction,
  } as unknown as PrismaService;

  return {
    service: new AuditQueryService(prisma),
    findMany,
    count,
    transaction,
  };
}

describe('AuditQueryService', () => {
  it('returns known audit actions', () => {
    const { service } = createService();

    expect(service.listActions()).toEqual(Object.values(AUDIT_ACTIONS));
  });

  it('uses page defaults, runs two scoped queries, and redacts details', async () => {
    const { service, findMany, count, transaction } = createService();

    const result = await service.list(PRINCIPAL, { page: 1, page_size: 25 });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: PRINCIPAL.store_id },
        skip: 0,
        take: 25,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { store_id: PRINCIPAL.store_id },
    });
    expect(result).toEqual({
      data: [
        {
          id: LOG.id,
          created_at: LOG.created_at,
          action: LOG.action,
          entity_type: 'Staff',
          entity_id: LOG.entity_id,
          actor: {
            id: LOG.staff.id,
            name: 'Ada Okafor',
            staff_code: 'CASH001',
            role: 'cashier',
          },
          details: { fields: ['first_name'] },
        },
      ],
      meta: {
        page: 1,
        page_size: 25,
        total: 1,
        total_pages: 1,
      },
    });
  });

  it('calculates skip, take, and metadata from the requested page', async () => {
    const { service, findMany } = createService([LOG], 42);

    const result = await service.list(PRINCIPAL, { page: 3, page_size: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.meta).toEqual({
      page: 3,
      page_size: 10,
      total: 42,
      total_pages: 5,
    });
  });

  it('uses the same filters for data and count', async () => {
    const { service, findMany, count } = createService([]);
    const query: ListAuditLogsQueryDto = {
      action: AUDIT_ACTIONS.staffUpdated,
      entity_type: '  Staff  ',
      entity_id: LOG.entity_id,
      staff_id: LOG.staff.id,
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
      page: 2,
      page_size: 10,
    };

    await service.list(PRINCIPAL, query);

    const expectedWhere = {
      store_id: PRINCIPAL.store_id,
      action: AUDIT_ACTIONS.staffUpdated,
      entity_type: 'Staff',
      entity_id: LOG.entity_id,
      staff_id: LOG.staff.id,
      created_at: {
        gte: new Date('2026-10-25T00:00:00.000Z'),
        lt: new Date('2026-10-26T00:00:00.000Z'),
      },
    };

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        where: expectedWhere,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('rejects invalid date ranges before querying', async () => {
    const { service, findMany, count, transaction } = createService();

    await expect(
      service.list(PRINCIPAL, {
        from: '2026-10-26T00:00:00.000Z',
        to: '2026-10-25T00:00:00.000Z',
        page: 0,
        page_size: 0,
      }),
    ).rejects.toBeInstanceOf(AppException);

    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
