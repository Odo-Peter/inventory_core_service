import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { StaffModel } from '../../generated/prisma/models.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { PinAttemptService } from '../auth/pin-attempt.service.js';
import { PinHasherService } from '../auth/pin-hasher.service.js';
import { PinPolicy } from '../auth/pin-policy.js';
import type { Principal } from '../auth/principal.js';
import type { ActingPinDto } from './dto/acting-pin.dto.js';
import type { CreateStaffDto } from './dto/create-staff.dto.js';
import type { UpdateStaffDto } from './dto/update-staff.dto.js';
import { toStaffResponse, type StaffResponse } from './staff.mapper.js';
import { maskPhone } from './phone.js';
import { generateStaffCode } from './staff-code.js';

export interface StaffWithTemporaryPin {
  staff: StaffResponse;
  temporary_pin: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinHasher: PinHasherService,
    private readonly pinPolicy: PinPolicy,
    private readonly pinAttempts: PinAttemptService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(principal: Principal): Promise<StaffResponse[]> {
    const staff = await this.prisma.staff.findMany({
      where: { store_id: principal.store_id },
      orderBy: [
        { first_name: 'asc' },
        { last_name: 'asc' },
        { staff_code: 'asc' },
      ],
    });
    const now = this.clock.now();

    return staff.map((member) => toStaffResponse(member, now));
  }

  async findOne(principal: Principal, staffId: string): Promise<StaffResponse> {
    const staff = await this.getTarget(principal.store_id, staffId);
    return toStaffResponse(staff, this.clock.now());
  }

  async create(
    principal: Principal,
    dto: CreateStaffDto,
  ): Promise<StaffWithTemporaryPin> {
    const role = dto.role ?? 'cashier';
    const temporaryPin = this.pinPolicy.generate();
    const pinHash = await this.pinHasher.hash(temporaryPin);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const staffCode = await generateStaffCode(tx, principal.store_id, role);

        const staff = await tx.staff.create({
          data: {
            store_id: principal.store_id,
            staff_code: staffCode,
            first_name: dto.first_name,
            last_name: dto.last_name,
            phone: dto.phone,
            role,
            pin_hash: pinHash,
            must_change_pin: true,
          },
        });

        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.staffCreated,
            entity_type: 'Staff',
            entity_id: staff.id,
            details: {
              staff_code: staff.staff_code,
              role: staff.role,
              first_name: staff.first_name,
              last_name: staff.last_name,
              phone: maskPhone(staff.phone),
            },
          },
          tx,
        );

        return staff;
      });

      return {
        staff: toStaffResponse(created, this.clock.now()),
        temporary_pin: temporaryPin,
      };
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new AppException(
          409,
          'staff_code_taken',
          'Staff code is already in use',
        );
      }
      throw error;
    }
  }

  async update(
    principal: Principal,
    staffId: string,
    dto: UpdateStaffDto,
  ): Promise<StaffResponse> {
    const target = await this.getTarget(principal.store_id, staffId);
    if (!target.active) {
      throw new AppException(
        409,
        'staff_inactive',
        'Reactivate this staff member first',
      );
    }

    if (
      dto.role !== undefined &&
      dto.role !== target.role &&
      principal.staff_id === target.id
    ) {
      throw new AppException(
        403,
        'forbidden',
        'You cannot change your own role',
      );
    }

    const data: {
      first_name?: string;
      last_name?: string;
      phone?: string;
      role?: StaffRoleValue;
      must_change_pin?: boolean;
    } = {};
    const profileFields: string[] = [];

    if (dto.first_name !== undefined && dto.first_name !== target.first_name) {
      data.first_name = dto.first_name;
      profileFields.push('first_name');
    }
    if (dto.last_name !== undefined && dto.last_name !== target.last_name) {
      data.last_name = dto.last_name;
      profileFields.push('last_name');
    }
    if (dto.phone !== undefined && dto.phone !== target.phone) {
      data.phone = dto.phone;
      profileFields.push('phone');
    }
    if (dto.role !== undefined && dto.role !== target.role) {
      data.role = dto.role;
      if (
        target.role === 'cashier' &&
        (dto.role === 'manager' || dto.role === 'admin')
      ) {
        data.must_change_pin = true;
      }
    }

    if (Object.keys(data).length === 0) {
      return toStaffResponse(target, this.clock.now());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.role !== undefined) {
        const openShifts = await tx.shift.count({
          where: {
            store_id: principal.store_id,
            staff_id: target.id,
            clock_out_at: null,
          },
        });

        if (openShifts > 0) {
          throw new AppException(
            409,
            'staff_has_open_shift',
            'Close the open shift before changing this role',
          );
        }

        await this.assertNotLastActiveAdmin(target, tx);
      }

      const staff = await tx.staff.update({
        where: { id: target.id },
        data,
      });

      if (profileFields.length > 0) {
        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.staffUpdated,
            entity_type: 'Staff',
            entity_id: staff.id,
            details: {
              fields: profileFields,
              ...(data.phone !== undefined && {
                phone_from: maskPhone(target.phone),
                phone_to: maskPhone(staff.phone),
              }),
            },
          },
          tx,
        );
      }

      if (data.role !== undefined) {
        await this.audit.record(
          {
            store_id: principal.store_id,
            staff_id: principal.staff_id,
            action: AUDIT_ACTIONS.staffRoleChanged,
            entity_type: 'Staff',
            entity_id: staff.id,
            details: { from_role: target.role, to_role: staff.role },
          },
          tx,
        );
      }

      return staff;
    });

    return toStaffResponse(updated, this.clock.now());
  }

  async deactivate(
    principal: Principal,
    staffId: string,
  ): Promise<StaffResponse> {
    const target = await this.getTarget(principal.store_id, staffId);

    if (target.id === principal.staff_id) {
      throw new AppException(
        403,
        'forbidden',
        'You cannot deactivate yourself',
      );
    }

    if (!target.active) {
      return toStaffResponse(target, this.clock.now());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.assertNotLastActiveAdmin(target, tx);

      const openShifts = await tx.shift.count({
        where: {
          store_id: principal.store_id,
          staff_id: target.id,
          clock_out_at: null,
        },
      });

      if (openShifts > 0) {
        throw new AppException(
          409,
          'staff_has_open_shift',
          'Staff member has an open shift',
        );
      }

      const staff = await tx.staff.update({
        where: { id: target.id },
        data: {
          active: false,
          token_version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.staffDeactivated,
          entity_type: 'Staff',
          entity_id: staff.id,
          details: { staff_code: staff.staff_code },
        },
        tx,
      );

      return staff;
    });

    return toStaffResponse(updated, this.clock.now());
  }

  async reactivate(
    principal: Principal,
    staffId: string,
  ): Promise<StaffResponse> {
    const target = await this.getTarget(principal.store_id, staffId);

    if (target.active) {
      return toStaffResponse(target, this.clock.now());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.update({
        where: { id: target.id },
        data: {
          active: true,
          failed_pin_attempts: 0,
          locked_until: null,
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.staffReactivated,
          entity_type: 'Staff',
          entity_id: staff.id,
          details: { staff_code: staff.staff_code },
        },
        tx,
      );

      return staff;
    });

    return toStaffResponse(updated, this.clock.now());
  }

  async resetPin(
    principal: Principal,
    staffId: string,
    dto: ActingPinDto,
  ): Promise<StaffWithTemporaryPin> {
    const target = await this.getTarget(principal.store_id, staffId);
    if (!target.active) {
      throw new AppException(
        409,
        'staff_inactive',
        'Reactivate this staff member first',
      );
    }
    await this.assertCanManageTarget(principal, target);
    await this.verifyActingPin(principal, dto.acting_pin);

    const temporaryPin = this.pinPolicy.generate();
    const pinHash = await this.pinHasher.hash(temporaryPin);

    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.update({
        where: { id: target.id },
        data: {
          pin_hash: pinHash,
          must_change_pin: true,
          failed_pin_attempts: 0,
          locked_until: null,
          token_version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.pinReset,
          entity_type: 'Staff',
          entity_id: staff.id,
          details: { role: staff.role },
        },
        tx,
      );

      return staff;
    });

    return {
      staff: toStaffResponse(updated, this.clock.now()),
      temporary_pin: temporaryPin,
    };
  }

  async unlock(
    principal: Principal,
    staffId: string,
    dto: ActingPinDto,
  ): Promise<StaffResponse> {
    const target = await this.getTarget(principal.store_id, staffId);
    if (!target.active) {
      throw new AppException(
        409,
        'staff_inactive',
        'Reactivate this staff member first',
      );
    }
    await this.assertCanManageTarget(principal, target);
    await this.verifyActingPin(principal, dto.acting_pin);

    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.update({
        where: { id: target.id },
        data: {
          failed_pin_attempts: 0,
          locked_until: null,
          token_version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.unlocked,
          entity_type: 'Staff',
          entity_id: staff.id,
          details: { role: staff.role },
        },
        tx,
      );

      return staff;
    });

    return toStaffResponse(updated, this.clock.now());
  }

  private async getTarget(
    storeId: string,
    staffId: string,
  ): Promise<StaffModel> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, store_id: storeId },
    });

    if (!staff) {
      throw new AppException(404, 'staff_not_found', 'Staff member not found');
    }

    return staff;
  }

  private async assertCanManageTarget(
    principal: Principal,
    target: StaffModel,
  ): Promise<void> {
    if (target.id === principal.staff_id) {
      throw new AppException(
        403,
        'forbidden',
        'Use the change-pin endpoint for your own account',
      );
    }

    if (principal.role === 'admin') {
      return;
    }

    if (principal.role === 'manager' && target.role === 'cashier') {
      return;
    }

    throw new AppException(
      403,
      'insufficient_role',
      'Managers may only manage cashiers',
    );
  }

  private async verifyActingPin(
    principal: Principal,
    actingPin: string,
  ): Promise<void> {
    const actor = await this.prisma.staff.findUnique({
      where: { id: principal.staff_id },
    });

    if (!actor) {
      throw new AppException(401, 'unauthorized', 'Staff not found');
    }

    const now = this.clock.now();
    if (actor.locked_until && actor.locked_until > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((actor.locked_until.getTime() - now.getTime()) / 1_000),
      );

      throw new AppException(
        423,
        'account_locked',
        'Account is locked',
        retryAfterSeconds,
      );
    }

    if (!(await this.pinHasher.verify(actor.pin_hash, actingPin))) {
      await this.pinAttempts.recordFailure(
        actor.id,
        actor.store_id,
        now,
        'acting_pin',
      );
      throw new AppException(
        403,
        'invalid_credentials',
        'The PIN you entered is incorrect. Please try again.',
      );
    }
  }

  private async assertNotLastActiveAdmin(
    target: StaffModel,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (target.role !== 'admin' || !target.active) {
      return;
    }

    const otherAdmins = await tx.staff.count({
      where: {
        store_id: target.store_id,
        role: 'admin',
        active: true,
        id: { not: target.id },
      },
    });

    if (otherAdmins === 0) {
      throw new AppException(
        409,
        'last_admin',
        'The last active admin cannot be removed',
      );
    }
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

type StaffRoleValue = StaffModel['role'];
