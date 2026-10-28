import { SetMetadata } from '@nestjs/common';

import type { StaffRole } from '../../../generated/prisma/enums.js';

export const DENY_ROLES_KEY = 'deny_roles';

export interface DenyRolesMetadata {
  roles: StaffRole[];
  code: string;
  message?: string;
}

export const DenyRoles = (
  roles: StaffRole[],
  options: { code?: string; message?: string } = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata(DENY_ROLES_KEY, {
    roles,
    code: options.code ?? 'forbidden',
    message: options.message,
  } satisfies DenyRolesMetadata);
