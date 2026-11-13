import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import { StockService } from '../inventory/stock.service.js';
import type {
  CreateSaleDto,
  CreateSaleItemDto,
} from './dto/create-sale.dto.js';
import type { ListSalesQueryDto } from './dto/list-sales-query.dto.js';
import type {
  PaymentOptionsResponseDto,
  ReceiptResponseDto,
  SaleListItemDto,
  SaleListResponseDto,
  SaleResponseDto,
  SalesSummaryResponseDto,
} from './dto/sale.dto.js';
import {
  saleDetailSelect,
  saleListSelect,
  saleStoreSelect,
  toReceiptStore,
  toSaleListItem,
  toSaleResponse,
  type SaleDetailRow,
} from './sale.mapper.js';

const INT_MAX = 2_147_483_647;

interface LockedSaleItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  current_price: number;
  stock_quantity: number;
  active: boolean;
}

interface SaleLine {
  item_id: string;
  quantity: number;
}

interface SaleLineSnapshot extends SaleLine {
  sku: string;
  name: string;
  unit: string;
  unit_price: number;
  line_total: number;
}

interface ResolvedPaymentAccount {
  id: string | null;
  label: string | null;
}

interface IdempotentSaleRow {
  id: string;
  staff_id: string;
}

interface ReceiptPrintResult {
  id: string;
  printed_at: Date;
  print_number: number;
  is_copy: boolean;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  async create(
    principal: Principal,
    dto: CreateSaleDto,
  ): Promise<SaleResponseDto> {
    if (dto.idempotency_key) {
      const replay = await this.findIdempotentSale(
        principal,
        dto.idempotency_key,
      );
      if (replay) {
        return this.replaySale(principal, replay);
      }
    }

    const lines = this.mergeLines(dto.items);
    const account = await this.resolvePaymentAccount(principal, dto);

    try {
      const saleId = await this.prisma.$transaction(async (tx) => {
        const shift = await tx.shift.findFirst({
          where: {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            clock_out_at: null,
          },
          select: { id: true },
          orderBy: { clock_in_at: 'desc' },
        });

        if (!shift) {
          throw new AppException(
            409,
            'no_open_shift',
            'Clock in before recording a sale',
          );
        }

        const itemIds = lines.map((line) => line.item_id);
        const lockedItems = await tx.$queryRaw<LockedSaleItem[]>(Prisma.sql`
          SELECT "id", "sku", "name", "unit", "current_price",
                 "stock_quantity", "active"
          FROM "Item"
          WHERE "store_id" = ${principal.store_id}
            AND "id" IN (${Prisma.join(itemIds)})
          ORDER BY "id"
          FOR UPDATE
        `);
        const itemsById = new Map(lockedItems.map((item) => [item.id, item]));

        const snapshots: SaleLineSnapshot[] = lines.map((line) => {
          const item = itemsById.get(line.item_id);
          if (!item) {
            throw new AppException(404, 'item_not_found', 'Item not found');
          }

          if (!item.active) {
            throw new AppException(
              409,
              'item_inactive',
              'This item is no longer available for sale',
            );
          }

          if (item.stock_quantity < line.quantity) {
            throw new AppException(
              409,
              'insufficient_stock',
              'Stock cannot go below zero',
            );
          }

          const lineTotal = item.current_price * line.quantity;
          if (!Number.isSafeInteger(lineTotal)) {
            throw this.saleTotalTooLarge();
          }

          return {
            item_id: item.id,
            quantity: line.quantity,
            sku: item.sku,
            name: item.name,
            unit: item.unit,
            unit_price: item.current_price,
            line_total: lineTotal,
          };
        });

        const subtotal = snapshots.reduce(
          (sum, line) => sum + line.line_total,
          0,
        );
        const taxTotal = 0;
        const total = subtotal + taxTotal;

        if (
          !Number.isSafeInteger(subtotal) ||
          subtotal > INT_MAX ||
          !Number.isSafeInteger(total) ||
          total > INT_MAX
        ) {
          throw this.saleTotalTooLarge();
        }

        if (total !== dto.expected_total) {
          throw new AppException(
            409,
            'total_mismatch',
            'The sale total has changed; refresh the cart and try again',
          );
        }

        const store = await tx.store.update({
          where: { id: principal.store_id },
          data: { sale_counter: { increment: 1 } },
          select: { sale_counter: true },
        });

        const sale = await tx.sale.create({
          data: {
            store_id: principal.store_id,
            receipt_number: store.sale_counter,
            shift_id: shift.id,
            staff_id: principal.staff_id,
            subtotal,
            tax_total: taxTotal,
            total,
            idempotency_key: dto.idempotency_key ?? null,
            items: {
              create: snapshots.map((line) => ({
                item_id: line.item_id,
                sku: line.sku,
                name: line.name,
                unit: line.unit,
                unit_price: line.unit_price,
                quantity: line.quantity,
                tax_amount: 0,
                line_total: line.line_total,
              })),
            },
            payment: {
              create: {
                method: dto.payment_method,
                amount: total,
                pos_account_id: account.id,
                account_label: account.label,
              },
            },
          },
          select: { id: true },
        });

        for (const line of snapshots) {
          await this.stock.applyMovementInTx(tx, principal, {
            item_id: line.item_id,
            quantity_change: -line.quantity,
            reason: 'sale',
            sale_id: sale.id,
          });
        }

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.saleCreated,
            entity_type: 'Sale',
            entity_id: sale.id,
            details: {
              receipt_number: store.sale_counter,
              total,
              payment_method: dto.payment_method,
              shift_id: shift.id,
              lines: snapshots.map((line) => ({
                item_id: line.item_id,
                sku: line.sku,
                quantity: line.quantity,
                unit_price: line.unit_price,
                line_total: line.line_total,
              })),
            },
          },
          tx,
        );

        return sale.id;
      });

      return this.findOne(principal, saleId);
    } catch (error: unknown) {
      if (dto.idempotency_key && this.isIdempotencyKeyViolation(error)) {
        const replay = await this.findIdempotentSale(
          principal,
          dto.idempotency_key,
        );
        if (replay) {
          return this.replaySale(principal, replay);
        }
      }

      throw error;
    }
  }

  async list(
    principal: Principal,
    query: ListSalesQueryDto,
  ): Promise<SaleListResponseDto> {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where = this.buildSaleWhere(principal, query);
    const { skip, take } = toSkipTake(page, pageSize);

    const [sales, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        select: saleListSelect,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.sale.count({ where }),
    ]);

    const data: SaleListItemDto[] = sales.map(toSaleListItem);

    return {
      data,
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async findOne(principal: Principal, id: string): Promise<SaleResponseDto> {
    return toSaleResponse(await this.findSaleDetail(principal, id));
  }

  async summary(
    principal: Principal,
    query: ListSalesQueryDto,
  ): Promise<SalesSummaryResponseDto> {
    const where = this.buildSaleWhere(principal, query);

    const [aggregate, groups] = await this.prisma.$transaction([
      this.prisma.sale.aggregate({
        where,
        _count: { _all: true },
        _sum: { subtotal: true, tax_total: true, total: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { sale: { is: where } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return {
      sale_count: aggregate._count._all,
      subtotal: aggregate._sum.subtotal ?? 0,
      tax_total: aggregate._sum.tax_total ?? 0,
      total: aggregate._sum.total ?? 0,
      by_payment_method: groups
        .map((group) => ({
          method: group.method,
          count: group._count._all,
          amount: group._sum.amount ?? 0,
        }))
        .sort((a, b) => a.method.localeCompare(b.method)),
    };
  }

  async paymentOptions(
    principal: Principal,
  ): Promise<PaymentOptionsResponseDto> {
    const accounts = await this.prisma.pOSAccount.findMany({
      where: { store_id: principal.store_id, active: true },
      select: { id: true, label: true, type: true },
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
    });

    const response: PaymentOptionsResponseDto = {
      cash: { method: 'cash', accounts: [] },
    };

    const terminals = accounts
      .filter((account) => account.type === 'pos_terminal')
      .map((account) => ({ id: account.id, label: account.label }));
    const bankAccounts = accounts
      .filter((account) => account.type === 'bank_account')
      .map((account) => ({ id: account.id, label: account.label }));

    if (terminals.length > 0) {
      response.card = { method: 'card', accounts: terminals };
    }
    if (bankAccounts.length > 0) {
      response.bank_transfer = {
        method: 'bank_transfer',
        accounts: bankAccounts,
      };
    }

    return response;
  }

  async printReceipt(
    principal: Principal,
    id: string,
  ): Promise<ReceiptResponseDto> {
    const [sale, store] = await Promise.all([
      this.findSaleDetail(principal, id),
      this.prisma.store.findFirst({
        where: { id: principal.store_id },
        select: saleStoreSelect,
      }),
    ]);

    if (!store) {
      throw new AppException(404, 'store_not_found', 'Store not found');
    }

    const receipt: ReceiptPrintResult = await this.prisma.$transaction(
      async (tx) => {
        const print = await tx.receiptPrint.create({
          data: {
            sale_id: sale.id,
            staff_id: principal.staff_id,
          },
          select: { id: true, printed_at: true },
        });

        const printNumber = await tx.receiptPrint.count({
          where: { sale_id: sale.id },
        });
        const isCopy = printNumber > 1;

        if (isCopy) {
          await this.audit.record(
            {
              store_id: principal.store_id,
              staff_id: principal.staff_id,
              action: AUDIT_ACTIONS.saleReceiptReprinted,
              entity_type: 'Sale',
              entity_id: sale.id,
              details: {
                receipt_number: sale.receipt_number,
                print_number: printNumber,
              },
            },
            tx,
          );
        }

        return {
          id: print.id,
          printed_at: print.printed_at,
          print_number: printNumber,
          is_copy: isCopy,
        };
      },
    );

    return {
      id: receipt.id,
      print_number: receipt.print_number,
      is_copy: receipt.is_copy,
      printed_at: receipt.printed_at,
      sale: toSaleResponse(sale),
      store: toReceiptStore(store),
    };
  }

  private async findSaleDetail(
    principal: Principal,
    id: string,
  ): Promise<SaleDetailRow> {
    const where: Prisma.SaleWhereInput = {
      id,
      store_id: principal.store_id,
    };
    if (principal.role === 'cashier') {
      where.staff_id = principal.staff_id;
    }

    const sale = await this.prisma.sale.findFirst({
      where,
      select: saleDetailSelect,
    });

    if (!sale) {
      throw new AppException(404, 'sale_not_found', 'Sale not found');
    }

    return sale;
  }

  private async findIdempotentSale(
    principal: Principal,
    key: string,
  ): Promise<IdempotentSaleRow | null> {
    return this.prisma.sale.findUnique({
      where: {
        store_id_idempotency_key: {
          store_id: principal.store_id,
          idempotency_key: key,
        },
      },
      select: { id: true, staff_id: true },
    });
  }

  private async replaySale(
    principal: Principal,
    sale: IdempotentSaleRow,
  ): Promise<SaleResponseDto> {
    if (sale.staff_id !== principal.staff_id) {
      throw new AppException(
        409,
        'idempotency_key_reused',
        'This idempotency key belongs to another staff member',
      );
    }

    return this.findOne(principal, sale.id);
  }

  private buildSaleWhere(
    principal: Principal,
    query: ListSalesQueryDto,
  ): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      store_id: principal.store_id,
    };

    if (principal.role === 'cashier') {
      where.staff_id = principal.staff_id;
    } else if (query.staff_id) {
      where.staff_id = query.staff_id;
    }

    if (query.shift_id) {
      where.shift_id = query.shift_id;
    }

    if (query.sale_id) {
      where.id = query.sale_id;
    }

    if (query.q) {
      where.receipt_number = Number(query.q);
    }

    if (query.payment_method) {
      where.payment = { is: { method: query.payment_method } };
    }

    const createdAt = this.buildDateFilter(query);
    if (createdAt) {
      where.created_at = createdAt;
    }

    return where;
  }

  private buildDateFilter(
    query: ListSalesQueryDto,
  ): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) {
      return undefined;
    }

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from > to) {
      throw new AppException(
        400,
        'invalid_date_range',
        'The from date must not be after the to date',
      );
    }

    return {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  private mergeLines(items: CreateSaleItemDto[]): SaleLine[] {
    const merged = new Map<string, number>();

    for (const item of items) {
      merged.set(item.item_id, (merged.get(item.item_id) ?? 0) + item.quantity);
    }

    return [...merged.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([item_id, quantity]) => ({ item_id, quantity }));
  }

  private async resolvePaymentAccount(
    principal: Principal,
    dto: CreateSaleDto,
  ): Promise<ResolvedPaymentAccount> {
    if (dto.payment_method === 'cash') {
      if (dto.pos_account_id) {
        throw new AppException(
          400,
          'payment_account_not_allowed',
          'Cash payments do not use a POS account',
        );
      }
      return { id: null, label: null };
    }

    if (
      dto.payment_method !== 'card' &&
      dto.payment_method !== 'bank_transfer'
    ) {
      throw new AppException(
        400,
        'invalid_payment_method',
        'Unsupported payment method',
      );
    }

    if (!dto.pos_account_id) {
      throw new AppException(
        400,
        'payment_account_required',
        'Select a payment account for this payment method',
      );
    }

    const type =
      dto.payment_method === 'card' ? 'pos_terminal' : 'bank_account';
    const account = await this.prisma.pOSAccount.findFirst({
      where: {
        id: dto.pos_account_id,
        store_id: principal.store_id,
        type,
        active: true,
      },
      select: { id: true, label: true },
    });

    if (!account) {
      throw new AppException(
        404,
        'payment_account_not_found',
        'Payment account not found',
      );
    }

    return { id: account.id, label: account.label };
  }

  private saleTotalTooLarge(): AppException {
    return new AppException(
      400,
      'sale_total_too_large',
      'Sale total is too large',
    );
  }

  private isIdempotencyKeyViolation(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      (error as { code: unknown }).code !== 'P2002'
    ) {
      return false;
    }

    const details = error as {
      message?: unknown;
      meta?: { target?: unknown; constraint?: unknown };
    };
    // Prisma reports the field list as `target`, but the driver adapter used in
    // production reports the constraint instead. Fall back to the message so
    // the replay works in both shapes.
    const signature = [
      JSON.stringify(details.meta?.target ?? ''),
      JSON.stringify(details.meta?.constraint ?? ''),
      typeof details.message === 'string' ? details.message : '',
    ].join(' ');

    return signature.toLowerCase().includes('idempotency_key');
  }
}
