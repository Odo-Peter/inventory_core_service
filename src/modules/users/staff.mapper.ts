import type { StaffModel } from '../../generated/prisma/models.js';
import type { StaffRole } from '../../generated/prisma/enums.js';

export interface StaffResponse {
  id: string;
  staff_code: string;
  name: string;
  role: StaffRole;
  active: boolean;
  store_id: string;
  must_change_pin: boolean;
  is_locked: boolean;
  created_at: Date;
  updated_at: Date;
}

export function toStaffResponse(
  staff: StaffModel,
  now: Date = new Date(),
): StaffResponse {
  return {
    id: staff.id,
    staff_code: staff.staff_code,
    name: staff.name,
    role: staff.role,
    active: staff.active,
    store_id: staff.store_id,
    must_change_pin: staff.must_change_pin,
    is_locked: staff.locked_until !== null && staff.locked_until > now,
    created_at: staff.created_at,
    updated_at: staff.updated_at,
  };
}
