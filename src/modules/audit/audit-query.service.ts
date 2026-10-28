import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Principal } from '../auth/principal.js';
import { AUDIT_ACTIONS } from './audit-actions.js';
import { toAuditLogResponse } from './audit-log.mapper.js';
import type { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';
import type {
  AuditLogListResponseDto,
  AuditLogResponseDto,
} from './dto/audit-log-response.dto.js';

const AUDIT_LOG_SELECT = {
  id: true,
  created_at: true,
  action: true,
  entity_type: true,
  entity_id: true,
  details: true,
  staff: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      staff_code: true,
      role: true,
    },
  },
} satisfies Prisma.AuditLogSelect;

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  listActions(): string[] {
    return Object.values(AUDIT_ACTIONS);
  }

  async list(
    principal: Principal,
    query: ListAuditLogsQueryDto,
  ): Promise<AuditLogListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const from = this.parseBoundary(query.from);
    const to = this.parseBoundary(query.to);

    if (from && to && from >= to) {
      throw new AppException(
        400,
        'invalid_date_range',
        'The from date must be before the to date',
      );
    }

    const where = this.buildWhere(principal.store_id, query, from, to);
    const { skip, take } = toSkipTake(page, pageSize);

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs.map((log): AuditLogResponseDto => toAuditLogResponse(log)),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  private buildWhere(
    storeId: string,
    query: ListAuditLogsQueryDto,
    from: Date | null,
    to: Date | null,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { store_id: storeId };

    if (query.action) {
      where.action = query.action;
    }

    if (query.entity_type !== undefined) {
      const entityType = query.entity_type.trim();
      if (entityType.length === 0) {
        throw new AppException(
          400,
          'invalid_entity_type',
          'Invalid entity type',
        );
      }
      where.entity_type = entityType;
    }

    if (query.entity_id) {
      where.entity_id = query.entity_id;
    }

    if (query.staff_id) {
      where.staff_id = query.staff_id;
    }

    if (from || to) {
      where.created_at = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    }

    return where;
  }

  private parseBoundary(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new AppException(400, 'invalid_date_filter', 'Invalid date filter');
    }

    return parsed;
  }
}
