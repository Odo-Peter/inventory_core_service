import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { StockMovementReason } from '../../generated/prisma/enums.js';
import type { StockMovementModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS, type AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type {
  AdjustStockDto,
  DamageStockDto,
  InitialStockDto,
  ReceiveStockDto,
  ReconciliationListResponseDto,
  StockMovementListResponseDto,
  StockMovementResponseDto,
  StockStatusResponseDto,
} from './dto/stock.dto.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { toStockMovementResponse } from './stock.mapper.js';

interface LockedItem {
  id: string;
  stock_quantity: number;
  active: boolean;
}

export interface ApplyMovementInput {
  item_id: string;
  quantity_change: number;
  reason: StockMovementReason;
  note?: string | null;
  sale_id?: string | null;
  refund_id?: string | null;
  audit_action: AuditAction;
  audit_details?: Prisma.InputJsonObject;
}

interface ReconciliationRow {
  item_id: string;
  sku: string;
  name: string;
  stock_quantity: number;
  movement_total: number;
  difference: number;
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async initialize(
    principal: Principal,
    itemId: string,
    dto: InitialStockDto,
  ): Promise<StockMovementResponseDto> {
    const movement = await this.applyMovement(principal, {
      item_id: itemId,
      quantity_change: dto.quantity,
      reason: 'initial',
      note: this.normalizeNote(dto.note),
      audit_action: AUDIT_ACTIONS.stockInitialized,
      audit_details: { quantity_change: dto.quantity },
    });

    return toStockMovementResponse(movement);
  }

  async receive(
    principal: Principal,
    itemId: string,
    dto: ReceiveStockDto,
  ): Promise<StockMovementResponseDto> {
    const details: Prisma.InputJsonObject = {
      quantity_change: dto.quantity,
      ...(dto.supplier_name !== undefined
        ? { supplier_name: dto.supplier_name.trim() }
        : {}),
      ...(dto.delivery_reference !== undefined
        ? { delivery_reference: dto.delivery_reference.trim() }
        : {}),
    };

    const movement = await this.applyMovement(principal, {
      item_id: itemId,
      quantity_change: dto.quantity,
      reason: 'restock',
      note: this.normalizeNote(dto.note),
      audit_action: AUDIT_ACTIONS.stockReceived,
      audit_details: details,
    });

    return toStockMovementResponse(movement);
  }

  async adjust(
    principal: Principal,
    itemId: string,
    dto: AdjustStockDto,
  ): Promise<StockMovementResponseDto> {
    const movement = await this.applyMovement(principal, {
      item_id: itemId,
      quantity_change: dto.quantity_change,
      reason: 'adjustment',
      note: this.normalizeNote(dto.note),
      audit_action: AUDIT_ACTIONS.stockAdjusted,
      audit_details: { quantity_change: dto.quantity_change },
    });

    return toStockMovementResponse(movement);
  }

  async recordDamage(
    principal: Principal,
    itemId: string,
    dto: DamageStockDto,
  ): Promise<StockMovementResponseDto> {
    const movement = await this.applyMovement(principal, {
      item_id: itemId,
      quantity_change: -dto.quantity,
      reason: 'damage',
      note: this.normalizeNote(dto.note),
      audit_action: AUDIT_ACTIONS.stockDamaged,
      audit_details: { quantity_change: -dto.quantity },
    });

    return toStockMovementResponse(movement);
  }

  /**
   * The single writer for `Item.stock_quantity`. Every stock change must go
   * through this method so a future stock-count lock check has one home.
   */
  async applyMovement(
    principal: Principal,
    input: ApplyMovementInput,
  ): Promise<StockMovementModel> {
    this.assertSign(input.reason, input.quantity_change);
    const requiresActiveItem =
      input.reason === 'initial' || input.reason === 'restock';
    const requiresNoPriorMovements = input.reason === 'initial';

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedItem[]>(Prisma.sql`
        SELECT "id", "stock_quantity", "active"
        FROM "Item"
        WHERE "id" = ${input.item_id} AND "store_id" = ${principal.store_id}
        FOR UPDATE
      `);

      const item = locked[0];
      if (!item) {
        throw new AppException(404, 'item_not_found', 'Item not found');
      }

      if (requiresActiveItem && !item.active) {
        throw new AppException(
          409,
          'item_inactive',
          'Reactivate this item before changing its stock this way',
        );
      }

      if (requiresNoPriorMovements) {
        const prior = await tx.stockMovement.count({
          where: { item_id: item.id },
        });
        if (prior > 0) {
          throw new AppException(
            409,
            'initial_stock_exists',
            'Opening stock has already been recorded for this item',
          );
        }
      }

      const movement = await tx.stockMovement.create({
        data: {
          store_id: principal.store_id,
          item_id: item.id,
          quantity_change: input.quantity_change,
          reason: input.reason,
          sale_id: input.sale_id ?? null,
          refund_id: input.refund_id ?? null,
          staff_id: principal.staff_id,
          note: input.note ?? null,
        },
      });

      if (input.quantity_change >= 0) {
        const updated = await tx.item.updateMany({
          where: { id: item.id, store_id: principal.store_id },
          data: { stock_quantity: { increment: input.quantity_change } },
        });

        if (updated.count !== 1) {
          throw new AppException(404, 'item_not_found', 'Item not found');
        }
      } else {
        const decrement = -input.quantity_change;
        const updated = await tx.item.updateMany({
          where: {
            id: item.id,
            store_id: principal.store_id,
            stock_quantity: { gte: decrement },
          },
          data: { stock_quantity: { decrement } },
        });

        if (updated.count !== 1) {
          throw new AppException(
            409,
            'insufficient_stock',
            'Stock cannot go below zero',
          );
        }
      }

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: input.audit_action,
          entity_type: 'Item',
          entity_id: item.id,
          details: {
            ...input.audit_details,
            movement_id: movement.id,
            reason: input.reason,
          },
        },
        tx,
      );

      return movement;
    });
  }

  async listMovements(
    principal: Principal,
    itemId: string,
    query: PaginationQueryDto,
  ): Promise<StockMovementListResponseDto> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, store_id: principal.store_id },
      select: { id: true },
    });

    if (!item) {
      throw new AppException(404, 'item_not_found', 'Item not found');
    }

    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.StockMovementWhereInput = {
      store_id: principal.store_id,
      item_id: item.id,
    };
    const { skip, take } = toSkipTake(page, pageSize);

    const [movements, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      data: movements.map(toStockMovementResponse),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async reconciliation(
    principal: Principal,
    query: PaginationQueryDto,
  ): Promise<ReconciliationListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const { skip, take } = toSkipTake(page, pageSize);
    const joined = Prisma.sql`
      FROM "Item" i
      LEFT JOIN (
        SELECT "item_id", COALESCE(SUM("quantity_change"), 0)::int AS total
        FROM "StockMovement"
        GROUP BY "item_id"
      ) m ON m."item_id" = i."id"
      WHERE i."store_id" = ${principal.store_id}
        AND i."stock_quantity" <> COALESCE(m.total, 0)
    `;

    const rows = await this.prisma.$queryRaw<ReconciliationRow[]>(Prisma.sql`
      SELECT
        i."id" AS item_id,
        i."sku",
        i."name",
        i."stock_quantity",
        COALESCE(m.total, 0)::int AS movement_total,
        (i."stock_quantity" - COALESCE(m.total, 0))::int AS difference
      ${joined}
      ORDER BY i."name" ASC, i."id" ASC
      LIMIT ${take} OFFSET ${skip}
    `);

    const countRows = await this.prisma.$queryRaw<Array<{ total: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS total ${joined}`,
    );

    const total = countRows[0]?.total ?? 0;

    return {
      data: rows,
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async getStockStatus(
    principal: Principal,
    itemId: string,
  ): Promise<StockStatusResponseDto> {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, store_id: principal.store_id },
      select: { id: true, active: true, stock_quantity: true },
    });
    if (!item) throw new AppException(404, 'item_not_found', 'Item not found');

    const firstMovement = await this.prisma.stockMovement.findFirst({
      where: { item_id: item.id, store_id: principal.store_id },
      select: { id: true },
    });
    const hasMovements = firstMovement !== null;

    return {
      item_id: item.id,
      active: item.active,
      stock_quantity: item.stock_quantity,
      has_movements: hasMovements,
      opening_stock_allowed: item.active && !hasMovements,
      receive_allowed: item.active,
    };
  }

  private assertSign(
    reason: StockMovementReason,
    quantityChange: number,
  ): void {
    if (!Number.isSafeInteger(quantityChange)) {
      throw new AppException(
        400,
        'invalid_quantity',
        'Stock quantity must be an integer',
      );
    }

    const valid =
      (['initial', 'restock', 'refund'].includes(reason) &&
        quantityChange > 0) ||
      (['sale', 'damage'].includes(reason) && quantityChange < 0) ||
      (reason === 'adjustment' && quantityChange !== 0);

    if (!valid) {
      throw new AppException(
        400,
        'invalid_stock_sign',
        'Stock quantity sign does not match the movement reason',
      );
    }
  }

  private normalizeNote(note: string | undefined): string | null {
    if (note === undefined) {
      return null;
    }

    const normalized = note.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
