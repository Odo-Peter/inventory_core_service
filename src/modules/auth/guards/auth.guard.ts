import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ALLOW_PIN_CHANGE_KEY } from '../decorators/allow-pin-change.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { Principal } from '../principal.js';
import { TokenService } from '../token.service.js';

interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new AppException(401, 'unauthorized', 'Missing bearer token');
    }

    const claims = await this.tokenService.verify(token);
    const staff = await this.prisma.staff.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        store_id: true,
        role: true,
        active: true,
        token_version: true,
        must_change_pin: true,
      },
    });

    if (!staff || staff.store_id !== claims.store_id) {
      throw new AppException(401, 'unauthorized', 'Invalid or revoked token');
    }

    if (staff.token_version !== claims.tv) {
      throw new AppException(401, 'unauthorized', 'Invalid or revoked token');
    }

    if (staff.active === false) {
      throw new AppException(
        401,
        'account_deactivated',
        'Your account has been deactivated. Contact an administrator.',
      );
    }

    const allowPinChange = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PIN_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (staff.must_change_pin && !allowPinChange) {
      throw new AppException(403, 'pin_change_required', 'PIN change required');
    }

    request.principal = {
      staff_id: staff.id,
      store_id: staff.store_id,
      role: staff.role,
    };

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const authorization = request.headers.authorization;
    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }

    return token;
  }
}
