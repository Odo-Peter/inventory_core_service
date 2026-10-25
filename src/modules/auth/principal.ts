import type { StaffRole } from '../../generated/prisma/enums.js';

export interface Principal {
  staff_id: string;
  store_id: string;
  role: StaffRole;
}

export const ROLE_RANK: Record<StaffRole, number> = {
  cashier: 0,
  manager: 1,
  admin: 2,
};
