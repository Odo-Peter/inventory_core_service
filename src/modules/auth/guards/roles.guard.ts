import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { StaffRole } from '../../../generated/prisma/enums.js';
import { AppException } from '../../../common/errors/app.exception.js';
import {
  DENY_ROLES_KEY,
  type DenyRolesMetadata,
} from '../decorators/deny-roles.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { type Principal, ROLE_RANK } from '../principal.js';

interface RoleRequest extends Request {
  principal?: Principal;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      throw new AppException(
        403,
        'insufficient_role',
        'Route has no role requirement',
      );
    }

    const request = context.switchToHttp().getRequest<RoleRequest>();
    const principal = request.principal;

    if (!principal) {
      throw new AppException(401, 'unauthorized', 'Please sign in to continue');
    }

    const denial = this.reflector.getAllAndOverride<DenyRolesMetadata>(
      DENY_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (denial?.roles.includes(principal.role)) {
      throw new AppException(
        403,
        denial.code,
        denial.message ??
          "You don't have permission to do that. Please ask an administrator if you need access.",
      );
    }

    const requiredRank = Math.min(...roles.map((role) => ROLE_RANK[role]));

    if (ROLE_RANK[principal.role] < requiredRank) {
      throw new AppException(
        403,
        'insufficient_role',
        "You don't have permission to do that. Please ask an administrator if you need access.",
      );
    }

    return true;
  }
}
