import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AUDIT_FORBIDDEN_DETAIL_KEYS,
  type AuditAction,
} from './audit-actions.js';

export interface AuditRecordInput {
  store_id: string;
  staff_id?: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id?: string | null;
  details?: Prisma.InputJsonObject;
}

function assertDetailsAreSafe(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDetailsAreSafe(item);
    }
    return;
  }

  if (typeof value !== 'object' || value === null) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const forbidden = AUDIT_FORBIDDEN_DETAIL_KEYS.some((candidate) =>
      normalizedKey.includes(candidate),
    );

    if (forbidden) {
      throw new Error(`Audit details contain a forbidden key: ${key}`);
    }

    assertDetailsAreSafe(nestedValue);
  }
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: AuditRecordInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    assertDetailsAreSafe(input.details);

    await tx.auditLog.create({
      data: {
        store_id: input.store_id,
        staff_id: input.staff_id ?? null,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id ?? null,
        details: input.details,
      },
    });
  }
}
