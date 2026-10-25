import { describe, expect, it } from 'vitest';

import type { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { AuditService } from './audit.service.js';

function createService(): {
  service: AuditService;
  created: Prisma.AuditLogCreateInput[];
} {
  const created: Prisma.AuditLogCreateInput[] = [];
  const prisma = {
    auditLog: {
      create: async ({ data }: { data: Prisma.AuditLogCreateInput }) => {
        created.push(data);
      },
    },
  } as unknown as PrismaService;

  return { service: new AuditService(prisma), created };
}

const BASE_INPUT = {
  store_id: '22222222-2222-4222-8222-222222222222',
  staff_id: '11111111-1111-4111-8111-111111111111',
  action: AUDIT_ACTIONS.staffUpdated,
  entity_type: 'Staff',
  entity_id: '11111111-1111-4111-8111-111111111111',
};

describe('AuditService detail guard', () => {
  it.each([
    'pin',
    'pin_hash',
    'token',
    'password',
    'secret',
    'pepper',
    'phone',
    'phone_number',
    'email',
  ])('rejects a details key named %s', async (key) => {
    const { service } = createService();

    await expect(
      service.record({
        ...BASE_INPUT,
        details: { [key]: 'forbidden-value' },
      }),
    ).rejects.toThrow(/forbidden key/);
  });

  it('rejects forbidden keys at any nesting level', async () => {
    const { service } = createService();

    await expect(
      service.record({
        ...BASE_INPUT,
        details: {
          change: {
            values: [{ email: 'ada@example.com' }],
          },
        },
      }),
    ).rejects.toThrow(/forbidden key/);
  });

  it('allows a phone key only when its value is masked', async () => {
    const { service, created } = createService();

    await service.record({
      ...BASE_INPUT,
      details: { phone: '+234803****567' },
    });

    expect(created).toHaveLength(1);

    await expect(
      service.record({
        ...BASE_INPUT,
        details: { phone: '+2348031234567' },
      }),
    ).rejects.toThrow(/forbidden key/);
  });

  it('accepts masked phone_from and phone_to values', async () => {
    const { service, created } = createService();

    await service.record({
      ...BASE_INPUT,
      details: {
        fields: ['phone'],
        phone_from: '+234803****567',
        phone_to: '+234803****999',
      },
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.details).toMatchObject({
      phone_from: '+234803****567',
      phone_to: '+234803****999',
    });
  });
});
