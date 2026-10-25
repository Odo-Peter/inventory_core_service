import type { StaffRole } from '../../generated/prisma/enums.js';
import { StaffModel } from '../../generated/prisma/models.js';

export interface StaffResponse {
  id: string;
  store_id: string;
  staff_code: string;
  first_name: string;
  last_name: string;
  phone: string;
  name: string;
  role: StaffRole;
  active: boolean;
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
    store_id: staff.store_id,
    staff_code: staff.staff_code,
    first_name: staff.first_name,
    last_name: staff.last_name,
    phone: staff.phone,
    name: `${staff.first_name} ${staff.last_name}`,
    role: staff.role,
    active: staff.active,
    must_change_pin: staff.must_change_pin,
    is_locked: staff.locked_until !== null && staff.locked_until > now,
    created_at: staff.created_at,
    updated_at: staff.updated_at,
  };
}
