import { SetMetadata } from '@nestjs/common';

import type { StaffRole } from '../../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

export const Roles = (
  ...roles: StaffRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
