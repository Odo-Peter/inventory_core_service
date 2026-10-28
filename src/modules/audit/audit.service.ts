import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditAction } from './audit-actions.js';
import { assertDetailsAreSafe } from './audit-details.js';

export interface AuditRecordInput {
  store_id: string;
  staff_id?: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id?: string | null;
  details?: Prisma.InputJsonObject;
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
