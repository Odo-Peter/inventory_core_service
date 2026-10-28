import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import {
  buildPageMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import {
  startOfDayInTimeZone,
  startOfNextDayInTimeZone,
} from '../../common/timezone.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type { Principal } from '../auth/principal.js';
import type { ClockInDto } from './dto/clock-in.dto.js';
import type { ClockOutDto } from './dto/clock-out.dto.js';
import type { ForceCloseDto } from './dto/force-close.dto.js';
import type { ListShiftsQueryDto } from './dto/list-shifts-query.dto.js';
import type {
  ShiftListResponseDto,
  ShiftResponseDto,
} from './dto/shift-response.dto.js';
import { toShiftResponse } from './shift.mapper.js';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async clockIn(
    principal: Principal,
    dto: ClockInDto,
  ): Promise<ShiftResponseDto> {
    this.assertCanClockInOrOut(principal);

    const openShift = await this.prisma.shift.findFirst({
      where: {
        store_id: principal.store_id,
        staff_id: principal.staff_id,
        clock_out_at: null,
      },
      select: { id: true },
    });

    if (openShift) {
      throw this.openShiftConflict();
    }

    try {
      const shift = await this.prisma.$transaction(async (tx) => {
        const created = await tx.shift.create({
          data: {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            clock_in_at: this.clock.now(),
            opening_float: dto.opening_float,
            opening_notes: dto.opening_notes,
          },
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.shiftClockIn,
            entity_type: 'Shift',
            entity_id: created.id,
            details: { opening_float: created.opening_float },
          },
          tx,
        );

        return created;
      });

      return toShiftResponse(shift);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw this.openShiftConflict();
      }
      throw error;
    }
  }

  async clockOut(
    principal: Principal,
    dto: ClockOutDto,
  ): Promise<ShiftResponseDto> {
    this.assertCanClockInOrOut(principal);

    const openShift = await this.prisma.shift.findFirst({
      where: {
        store_id: principal.store_id,
        staff_id: principal.staff_id,
        clock_out_at: null,
      },
      orderBy: { clock_in_at: 'desc' },
    });

    if (!openShift) {
      const storeOpenShifts = await this.prisma.shift.count({
        where: {
          store_id: principal.store_id,
          clock_out_at: null,
        },
      });

      if (storeOpenShifts > 0) {
        throw new AppException(
          403,
          'not_shift_owner',
          'You can only close your own shift',
        );
      }

      const previousShift = await this.prisma.shift.findFirst({
        where: {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
        },
        orderBy: { clock_in_at: 'desc' },
        select: { id: true },
      });

      if (previousShift) {
        throw new AppException(
          409,
          'shift_not_open',
          'Shift is already closed',
        );
      }

      throw new AppException(
        409,
        'no_open_shift',
        'There is no open shift to close',
      );
    }

    const shift = await this.prisma.$transaction(async (tx) => {
      const update = await tx.shift.updateMany({
        where: {
          id: openShift.id,
          clock_out_at: null,
        },
        data: {
          clock_out_at: this.clock.now(),
          closing_cash_counted: dto.closing_cash_counted,
          closing_notes: dto.closing_notes,
          closed_by_staff_id: principal.staff_id,
          close_reason: 'normal',
        },
      });

      if (update.count !== 1) {
        throw new AppException(
          409,
          'shift_not_open',
          'Shift is already closed',
        );
      }

      const closed = await tx.shift.findUniqueOrThrow({
        where: { id: openShift.id },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.shiftClockOut,
          entity_type: 'Shift',
          entity_id: closed.id,
          details: {
            closing_cash_counted: closed.closing_cash_counted ?? 0,
          },
        },
        tx,
      );

      return closed;
    });

    return toShiftResponse(shift);
  }

  async getCurrent(principal: Principal): Promise<ShiftResponseDto | null> {
    const shift = await this.prisma.shift.findFirst({
      where: {
        store_id: principal.store_id,
        staff_id: principal.staff_id,
        clock_out_at: null,
      },
      orderBy: { clock_in_at: 'desc' },
    });

    return shift ? toShiftResponse(shift) : null;
  }

  async list(
    principal: Principal,
    query: ListShiftsQueryDto,
  ): Promise<ShiftListResponseDto> {
    const timezone =
      principal.timezone ?? (await this.loadStoreTimezone(principal.store_id));
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.ShiftWhereInput = {
      store_id: principal.store_id,
    };

    if (query.staff_id) {
      where.staff_id = query.staff_id;
    }

    try {
      if (query.from) {
        where.clock_in_at = {
          ...(where.clock_in_at as Prisma.DateTimeFilter | undefined),
          gte: startOfDayInTimeZone(query.from, timezone),
        };
      }
      if (query.to) {
        where.clock_in_at = {
          ...(where.clock_in_at as Prisma.DateTimeFilter | undefined),
          lt: startOfNextDayInTimeZone(query.to, timezone),
        };
      }
    } catch {
      throw new AppException(400, 'invalid_date', 'Invalid date filter');
    }

    const { skip, take } = toSkipTake(page, pageSize);
    const [shifts, total] = await this.prisma.$transaction([
      this.prisma.shift.findMany({
        where,
        orderBy: [{ clock_in_at: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.shift.count({ where }),
    ]);

    return {
      data: shifts.map(toShiftResponse),
      meta: buildPageMeta(total, page, pageSize),
    };
  }

  async forceClose(
    principal: Principal,
    shiftId: string,
    dto: ForceCloseDto,
  ): Promise<ShiftResponseDto> {
    if (principal.role !== 'manager' && principal.role !== 'admin') {
      throw new AppException(
        403,
        'insufficient_role',
        'You do not have permission to force-close shifts',
      );
    }

    const shift = await this.prisma.shift.findFirst({
      where: {
        id: shiftId,
        store_id: principal.store_id,
      },
      include: {
        staff: { select: { role: true } },
      },
    });

    if (!shift) {
      throw new AppException(404, 'shift_not_found', 'Shift not found');
    }

    if (shift.clock_out_at !== null) {
      throw new AppException(409, 'shift_not_open', 'Shift is already closed');
    }

    if (principal.role === 'manager' && shift.staff.role !== 'cashier') {
      throw new AppException(
        403,
        'insufficient_role',
        'Managers can only force-close cashier shifts',
      );
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.shift.updateMany({
        where: { id: shift.id, clock_out_at: null },
        data: {
          clock_out_at: this.clock.now(),
          closing_cash_counted: dto.closing_cash_counted,
          closing_notes: dto.reason,
          closed_by_staff_id: principal.staff_id,
          close_reason: 'forced',
        },
      });

      if (update.count !== 1) {
        throw new AppException(
          409,
          'shift_not_open',
          'Shift is already closed',
        );
      }

      const result = await tx.shift.findUniqueOrThrow({
        where: { id: shift.id },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.shiftForceClosed,
          entity_type: 'Shift',
          entity_id: result.id,
          details: {
            reason: dto.reason,
            target_staff_id: result.staff_id,
            closed_by_staff_id: principal.staff_id,
          },
        },
        tx,
      );

      return result;
    });

    return toShiftResponse(closed);
  }

  private async loadStoreTimezone(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { timezone: true },
    });

    if (!store) {
      throw new AppException(404, 'store_not_found', 'Store not found');
    }

    return store.timezone;
  }

  private assertCanClockInOrOut(principal: Principal): void {
    if (principal.role === 'admin') {
      throw new AppException(
        403,
        'forbidden',
        'Admins cannot start or close shifts. Use force-close instead.',
      );
    }
  }

  private openShiftConflict(): AppException {
    return new AppException(
      409,
      'staff_has_open_shift',
      'Staff member already has an open shift',
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'P2002'
    );
  }
}
