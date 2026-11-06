import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { POSAccountModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type {
  CreatePosAccountDto,
  ListPosAccountsQueryDto,
  PosAccountListResponseDto,
  PosAccountResponseDto,
  UpdatePosAccountDto,
} from './dto/pos-account.dto.js';
import { toPosAccountResponse } from './pos-account.mapper.js';

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeDetails(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

@Injectable()
export class PosAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    principal: Principal,
    query: ListPosAccountsQueryDto,
  ): Promise<PosAccountListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.POSAccountWhereInput = {
      store_id: principal.store_id,
    };

    if (query.active !== undefined) {
      where.active = query.active;
    }
    if (query.type !== undefined) {
      where.type = query.type;
    }

    const { skip, take } = toSkipTake(page, pageSize);
    const [accounts, total] = await this.prisma.$transaction([
      this.prisma.pOSAccount.findMany({
        where,
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.pOSAccount.count({ where }),
    ]);

    return {
      data: accounts.map(toPosAccountResponse),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async findOne(
    principal: Principal,
    id: string,
  ): Promise<PosAccountResponseDto> {
    return toPosAccountResponse(await this.findScopedAccount(principal, id));
  }

  async create(
    principal: Principal,
    dto: CreatePosAccountDto,
  ): Promise<PosAccountResponseDto> {
    const details = normalizeDetails(dto.details);
    this.assertSafeDetails(details);

    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.pOSAccount.create({
        data: {
          store_id: principal.store_id,
          label: normalizeLabel(dto.label),
          type: dto.type,
          details,
          created_by_staff_id: principal.staff_id,
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.posAccountCreated,
          entity_type: 'POSAccount',
          entity_id: created.id,
          details: { label: created.label, type: created.type },
        },
        tx,
      );

      return created;
    });

    return toPosAccountResponse(account);
  }

  async update(
    principal: Principal,
    id: string,
    dto: UpdatePosAccountDto,
  ): Promise<PosAccountResponseDto> {
    const existing = await this.findScopedAccount(principal, id);
    const data: Prisma.POSAccountUpdateInput = {};
    const auditDetails: Record<string, string> = {};

    if (dto.label !== undefined) {
      const label = normalizeLabel(dto.label);
      if (label !== existing.label) {
        data.label = label;
        auditDetails.label_from = existing.label;
        auditDetails.label_to = label;
      }
    }

    if (dto.type !== undefined && dto.type !== existing.type) {
      data.type = dto.type;
      auditDetails.type_from = existing.type;
      auditDetails.type_to = dto.type;
    }

    if (dto.details !== undefined) {
      const details = normalizeDetails(dto.details);
      this.assertSafeDetails(details);
      if (details !== existing.details) {
        data.details = details;
      }
    }

    if (Object.keys(data).length === 0) {
      return toPosAccountResponse(existing);
    }

    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pOSAccount.update({
        where: { id: existing.id },
        data,
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.posAccountUpdated,
          entity_type: 'POSAccount',
          entity_id: updated.id,
          details: auditDetails,
        },
        tx,
      );

      return updated;
    });

    return toPosAccountResponse(account);
  }

  async deactivate(
    principal: Principal,
    id: string,
  ): Promise<PosAccountResponseDto> {
    const existing = await this.findScopedAccount(principal, id);
    if (!existing.active) {
      return toPosAccountResponse(existing);
    }

    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.pOSAccount.update({
        where: { id: existing.id },
        data: { active: false },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.posAccountDeactivated,
          entity_type: 'POSAccount',
          entity_id: updated.id,
          details: { label: updated.label, type: updated.type },
        },
        tx,
      );

      return updated;
    });

    return toPosAccountResponse(account);
  }

  private async findScopedAccount(
    principal: Principal,
    id: string,
  ): Promise<POSAccountModel> {
    const account = await this.prisma.pOSAccount.findFirst({
      where: { id, store_id: principal.store_id },
    });

    if (!account) {
      throw new AppException(
        404,
        'pos_account_not_found',
        'POS account not found',
      );
    }

    return account;
  }

  private assertSafeDetails(details: string | null): void {
    if (!details) {
      return;
    }

    const digitsOnly = details.replace(/[\s.-]/g, '');
    if (/\d{12,}/.test(digitsOnly)) {
      throw new AppException(
        400,
        'unsafe_pos_account_details',
        'Do not store full card or account numbers; keep only a label or last 4 digits',
      );
    }
  }
}
