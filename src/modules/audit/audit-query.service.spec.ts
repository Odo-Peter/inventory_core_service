import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';
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

function createService(logs: unknown[] = [LOG]): {
  service: AuditQueryService;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(logs);
  const prisma = {
    auditLog: { findMany },
  } as unknown as PrismaService;

  return { service: new AuditQueryService(prisma), findMany };
}

describe('AuditQueryService', () => {
  it('returns known audit actions', () => {
    const { service } = createService();

    expect(service.listActions()).toEqual(Object.values(AUDIT_ACTIONS));
  });

  it('runs one scoped query and redacts details', async () => {
    const { service, findMany } = createService();

    const result = await service.list(PRINCIPAL, {});

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: PRINCIPAL.store_id },
        take: 26,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    );
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
      next_cursor: null,
    });
  });

  it('paginates identical timestamps with an opaque cursor', async () => {
    const secondLog = {
      ...LOG,
      id: '44444444-4444-4444-8444-444444444444',
    };
    const extraLog = {
      ...LOG,
      id: '55555555-5555-4555-8555-555555555555',
    };
    const { service, findMany } = createService([LOG, secondLog, extraLog]);

    const result = await service.list(PRINCIPAL, { limit: 2 });

    expect(result.data.map((log) => log.id)).toEqual([LOG.id, secondLog.id]);
    expect(result.next_cursor).toBeTypeOf('string');
    expect(decodeAuditCursor(result.next_cursor as string)).toEqual({
      created_at: secondLog.created_at,
      id: secondLog.id,
    });

    const cursor = encodeAuditCursor({
      created_at: secondLog.created_at,
      id: secondLog.id,
    });
    findMany.mockResolvedValueOnce([]);

    await service.list(PRINCIPAL, { limit: 2, cursor });

    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          store_id: PRINCIPAL.store_id,
          AND: [
            {
              OR: [
                { created_at: { lt: secondLog.created_at } },
                {
                  created_at: secondLog.created_at,
                  id: { lt: secondLog.id },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('applies filters and date bounds', async () => {
    const { service, findMany } = createService([]);
    const query: ListAuditLogsQueryDto = {
      action: AUDIT_ACTIONS.staffUpdated,
      entity_type: '  Staff  ',
      entity_id: LOG.entity_id,
      staff_id: LOG.staff.id,
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
      limit: 10,
    };

    await service.list(PRINCIPAL, query);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 11,
        where: {
          store_id: PRINCIPAL.store_id,
          action: AUDIT_ACTIONS.staffUpdated,
          entity_type: 'Staff',
          entity_id: LOG.entity_id,
          staff_id: LOG.staff.id,
          created_at: {
            gte: new Date('2026-10-25T00:00:00.000Z'),
            lt: new Date('2026-10-26T00:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('rejects invalid cursors and date ranges before querying', async () => {
    const { service, findMany } = createService();

    await expect(
      service.list(PRINCIPAL, { cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(AppException);

    await expect(
      service.list(PRINCIPAL, {
        from: '2026-10-26T00:00:00.000Z',
        to: '2026-10-25T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(AppException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
