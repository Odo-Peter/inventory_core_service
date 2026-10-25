import type { ShiftModel } from '../../generated/prisma/models.js';
import type { ShiftResponseDto } from './dto/shift-response.dto.js';

export function toShiftResponse(shift: ShiftModel): ShiftResponseDto {
  return {
    id: shift.id,
    store_id: shift.store_id,
    staff_id: shift.staff_id,
    clock_in_at: shift.clock_in_at,
    clock_out_at: shift.clock_out_at,
    opening_float: shift.opening_float,
    closing_cash_counted: shift.closing_cash_counted,
    opening_notes: shift.opening_notes,
    closing_notes: shift.closing_notes,
    closed_by_staff_id: shift.closed_by_staff_id,
    close_reason: shift.close_reason,
    created_at: shift.created_at,
    updated_at: shift.updated_at,
  };
}
