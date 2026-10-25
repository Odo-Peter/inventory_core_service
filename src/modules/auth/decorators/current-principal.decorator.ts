import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { Principal } from '../principal.js';

export interface PrincipalRequest extends Request {
  principal: Principal;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    return request.principal;
  },
);
