import type { POSAccountModel } from '../../generated/prisma/models.js';
import type { PosAccountResponseDto } from './dto/pos-account.dto.js';

export function toPosAccountResponse(
  account: POSAccountModel,
): PosAccountResponseDto {
  return {
    id: account.id,
    store_id: account.store_id,
    label: account.label,
    type: account.type,
    details: account.details,
    active: account.active,
    created_by_staff_id: account.created_by_staff_id,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}
