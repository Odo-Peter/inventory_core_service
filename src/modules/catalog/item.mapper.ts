import type { StaffRole } from '../../generated/prisma/enums.js';
import type { ItemModel, PriceHistoryModel } from '../../generated/prisma/models.js';
import type {
  ItemResponseDto,
  PriceHistoryResponseDto,
} from './dto/item.dto.js';

export function toItemResponse(
  item: ItemModel,
  role: StaffRole,
): ItemResponseDto {
  const response: ItemResponseDto = {
    id: item.id,
    store_id: item.store_id,
    sku: item.sku,
    barcode: item.barcode,
    image_key: item.image_key,
    name: item.name,
    category_id: item.category_id,
    unit: item.unit,
    current_price: item.current_price,
    stock_quantity: item.stock_quantity,
    reorder_threshold: item.reorder_threshold,
    active: item.active,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };

  if (role === 'manager' || role === 'admin') {
    response.cost_price = item.cost_price;
  }

  return response;
}

export function toPriceHistoryResponse(
  entry: PriceHistoryModel,
): PriceHistoryResponseDto {
  return {
    id: entry.id,
    item_id: entry.item_id,
    old_price: entry.old_price,
    new_price: entry.new_price,
    changed_by_staff_id: entry.changed_by_staff_id,
    changed_at: entry.changed_at,
  };
}
