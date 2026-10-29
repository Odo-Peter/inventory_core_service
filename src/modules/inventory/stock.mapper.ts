import type { StockMovementModel } from '../../generated/prisma/models.js';
import type { StockMovementResponseDto } from './dto/stock.dto.js';

export function toStockMovementResponse(
  movement: StockMovementModel,
): StockMovementResponseDto {
  return {
    id: movement.id,
    store_id: movement.store_id,
    item_id: movement.item_id,
    quantity_change: movement.quantity_change,
    reason: movement.reason,
    sale_id: movement.sale_id,
    refund_id: movement.refund_id,
    staff_id: movement.staff_id,
    note: movement.note,
    created_at: movement.created_at,
  };
}
