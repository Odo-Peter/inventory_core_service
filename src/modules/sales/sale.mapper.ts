import type { Prisma } from '../../generated/prisma/client.js';
import type {
  ReceiptStoreDto,
  SaleListItemDto,
  SaleResponseDto,
} from './dto/sale.dto.js';

export const saleListSelect = {
  id: true,
  store_id: true,
  receipt_number: true,
  shift_id: true,
  staff_id: true,
  subtotal: true,
  tax_total: true,
  total: true,
  created_at: true,
  staff: { select: { first_name: true, last_name: true } },
  payment: { select: { method: true } },
  _count: { select: { items: true } },
} satisfies Prisma.SaleSelect;

export const saleDetailSelect = {
  id: true,
  store_id: true,
  receipt_number: true,
  shift_id: true,
  staff_id: true,
  subtotal: true,
  tax_total: true,
  total: true,
  created_at: true,
  staff: { select: { first_name: true, last_name: true } },
  payment: {
    select: {
      id: true,
      method: true,
      amount: true,
      pos_account_id: true,
      account_label: true,
    },
  },
  items: {
    select: {
      id: true,
      item_id: true,
      sku: true,
      name: true,
      unit: true,
      unit_price: true,
      quantity: true,
      tax_amount: true,
      line_total: true,
    },
    orderBy: { item_id: 'asc' },
  },
} satisfies Prisma.SaleSelect;

export const saleStoreSelect = {
  name: true,
  address: true,
  phone: true,
  currency: true,
  receipt_footer: true,
} satisfies Prisma.StoreSelect;

export type SaleListRow = Prisma.SaleGetPayload<{
  select: typeof saleListSelect;
}>;

export type SaleDetailRow = Prisma.SaleGetPayload<{
  select: typeof saleDetailSelect;
}>;

export type ReceiptStoreRow = Prisma.StoreGetPayload<{
  select: typeof saleStoreSelect;
}>;

function staffName(staff: { first_name: string; last_name: string }): string {
  return `${staff.first_name} ${staff.last_name}`;
}

export function toSaleListItem(row: SaleListRow): SaleListItemDto {
  return {
    id: row.id,
    store_id: row.store_id,
    receipt_number: row.receipt_number,
    shift_id: row.shift_id,
    staff_id: row.staff_id,
    staff_name: staffName(row.staff),
    subtotal: row.subtotal,
    tax_total: row.tax_total,
    total: row.total,
    payment_method: row.payment?.method ?? null,
    item_count: row._count.items,
    created_at: row.created_at,
  };
}

export function toSaleResponse(row: SaleDetailRow): SaleResponseDto {
  return {
    id: row.id,
    store_id: row.store_id,
    receipt_number: row.receipt_number,
    shift_id: row.shift_id,
    staff_id: row.staff_id,
    staff_name: staffName(row.staff),
    subtotal: row.subtotal,
    tax_total: row.tax_total,
    total: row.total,
    payment_method: row.payment?.method ?? null,
    item_count: row.items.length,
    created_at: row.created_at,
    items: row.items.map((item) => ({
      id: item.id,
      item_id: item.item_id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      unit_price: item.unit_price,
      quantity: item.quantity,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
    })),
    payment: row.payment
      ? {
          id: row.payment.id,
          method: row.payment.method,
          amount: row.payment.amount,
          pos_account_id: row.payment.pos_account_id,
          account_label: row.payment.account_label,
        }
      : null,
  };
}

export function toReceiptStore(row: ReceiptStoreRow): ReceiptStoreDto {
  return {
    name: row.name,
    address: row.address,
    phone: row.phone,
    currency: row.currency,
    receipt_footer: row.receipt_footer,
  };
}
