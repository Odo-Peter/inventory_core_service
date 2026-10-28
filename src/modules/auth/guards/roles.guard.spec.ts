import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../../common/errors/app.exception.js';
import type { StaffRole } from '../../../generated/prisma/enums.js';
import { ShiftsController } from '../../shifts/shifts.controller.js';
import { RolesGuard } from './roles.guard.js';

type ShiftHandler = 'clockIn' | 'clockOut' | 'forceClose';

const MATRIX: Array<{
  handler: ShiftHandler;
  allowed: StaffRole[];
  denied: StaffRole[];
}> = [
  {
    handler: 'clockIn',
    allowed: ['cashier', 'manager'],
    denied: ['admin'],
  },
  {
    handler: 'clockOut',
    allowed: ['cashier', 'manager'],
    denied: ['admin'],
  },
  {
    handler: 'forceClose',
    allowed: ['manager', 'admin'],
    denied: ['cashier'],
  },
];

function contextFor(handler: ShiftHandler, role: StaffRole): ExecutionContext {
  return {
    getHandler: () => ShiftsController.prototype[handler],
    getClass: () => ShiftsController,
    switchToHttp: () => ({
      getRequest: () => ({
        principal: {
          staff_id: '11111111-1111-4111-8111-111111111111',
          store_id: '22222222-2222-4222-8222-222222222222',
          role,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

function activate(handler: ShiftHandler, role: StaffRole): true | AppException {
  const guard = new RolesGuard(new Reflector());
  try {
    guard.canActivate(contextFor(handler, role));
    return true;
  } catch (error: unknown) {
    if (error instanceof AppException) {
      return error;
    }
    throw error;
  }
}

describe('RolesGuard shift matrix', () => {
  for (const { handler, allowed, denied } of MATRIX) {
    it.each(allowed)(`allows %s on ${handler}`, (role) => {
      expect(activate(handler, role)).toBe(true);
    });

    it.each(denied)(`denies %s on ${handler}`, (role) => {
      const result = activate(handler, role);

      expect(result).toBeInstanceOf(AppException);
      expect((result as AppException).getStatus()).toBe(403);
    });
  }

  it('uses the forbidden message when an admin starts or closes a shift', () => {
    for (const handler of ['clockIn', 'clockOut'] as const) {
      const result = activate(handler, 'admin') as AppException;

      expect(result.getResponse()).toMatchObject({
        code: 'forbidden',
        message:
          'Admins cannot start or close shifts. Use force-close instead.',
      });
    }
  });
});
