import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../common/clock.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { StaffRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  LoginResponseDto,
  MeResponseDto,
} from './dto/auth-response.dto.js';
import type { ChangePinDto } from './dto/change-pin.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import { PinAttemptService } from './pin-attempt.service.js';
import { PinHasherService } from './pin-hasher.service.js';
import { PinPolicy } from './pin-policy.js';
import type { Principal } from './principal.js';
import { TokenService, type AccessToken } from './token.service.js';

interface AuthStaff {
  id: string;
  name: string;
  role: StaffRole;
  store_id: string;
  must_change_pin: boolean;
}

interface LoginResult {
  staff: AuthStaff;
  token: AccessToken;
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid staff code or PIN';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinHasher: PinHasherService,
    private readonly pinPolicy: PinPolicy,
    private readonly tokenService: TokenService,
    private readonly audit: AuditService,
    private readonly pinAttempts: PinAttemptService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const store = await this.resolveActiveStore();
    const staff = await this.prisma.staff.findUnique({
      where: {
        store_id_staff_code: {
          store_id: store.id,
          staff_code: dto.staff_code,
        },
      },
    });

    if (!staff) {
      await this.verifyAgainstDummy(dto.pin);
      await this.audit.record({
        store_id: store.id,
        staff_id: null,
        action: AUDIT_ACTIONS.loginFailed,
        entity_type: 'Staff',
        entity_id: null,
        details: {
          staff_code: dto.staff_code,
          reason: 'unknown_staff_code',
        },
      });
      throw this.invalidCredentials();
    }

    const now = this.clock.now();
    if (staff.locked_until && staff.locked_until > now) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((staff.locked_until.getTime() - now.getTime()) / 1_000),
      );

      throw new AppException(
        423,
        'account_locked',
        'Account is locked',
        retryAfterSeconds,
      );
    }

    if (!(await this.pinHasher.verify(staff.pin_hash, dto.pin))) {
      await this.pinAttempts.recordFailure(
        staff.id,
        store.id,
        now,
        'invalid_pin',
      );
      throw this.invalidCredentials();
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedStaff = await tx.staff.update({
        where: { id: staff.id },
        data: {
          failed_pin_attempts: 0,
          locked_until: null,
        },
      });

      await this.audit.record(
        {
          store_id: store.id,
          staff_id: staff.id,
          action: AUDIT_ACTIONS.loginSucceeded,
          entity_type: 'Staff',
          entity_id: staff.id,
        },
        tx,
      );

      return {
        staff: updatedStaff,
        token: await this.tokenService.sign(
          updatedStaff.id,
          updatedStaff.store_id,
          updatedStaff.token_version,
        ),
      } satisfies LoginResult;
    });

    return this.toLoginResponse(result);
  }

  async logout(principal: Principal): Promise<{ success: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.update({
        where: { id: principal.staff_id },
        data: { token_version: { increment: 1 } },
      });

      await this.audit.record(
        {
          store_id: principal.store_id,
          staff_id: principal.staff_id,
          action: AUDIT_ACTIONS.logout,
          entity_type: 'Staff',
          entity_id: principal.staff_id,
        },
        tx,
      );
    });

    return { success: true };
  }

  async me(principal: Principal): Promise<MeResponseDto> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: principal.staff_id },
    });

    if (!staff) {
      throw new AppException(401, 'unauthorized', 'Staff not found');
    }

    const openShift = await this.prisma.shift.findFirst({
      where: {
        store_id: principal.store_id,
        staff_id: principal.staff_id,
        clock_out_at: null,
      },
      select: { id: true },
    });

    return {
      ...this.toAuthStaff(staff),
      active_shift_id: openShift?.id ?? null,
    };
  }

  async changePin(
    principal: Principal,
    dto: ChangePinDto,
  ): Promise<LoginResponseDto> {
    const staff = await this.prisma.staff.findUnique({
      where: { id: principal.staff_id },
    });

    if (!staff) {
      throw new AppException(401, 'unauthorized', 'Staff not found');
    }

    if (!(await this.pinHasher.verify(staff.pin_hash, dto.current_pin))) {
      throw this.invalidCredentials();
    }

    this.pinPolicy.validate(dto.new_pin, staff.role);
    const pinHash = await this.pinHasher.hash(dto.new_pin);

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedStaff = await tx.staff.update({
        where: { id: staff.id },
        data: {
          pin_hash: pinHash,
          must_change_pin: false,
          failed_pin_attempts: 0,
          locked_until: null,
          token_version: { increment: 1 },
        },
      });

      await this.audit.record(
        {
          store_id: staff.store_id,
          staff_id: staff.id,
          action: AUDIT_ACTIONS.pinChanged,
          entity_type: 'Staff',
          entity_id: staff.id,
        },
        tx,
      );

      return {
        staff: updatedStaff,
        token: await this.tokenService.sign(
          updatedStaff.id,
          updatedStaff.store_id,
          updatedStaff.token_version,
        ),
      } satisfies LoginResult;
    });

    return this.toLoginResponse(result);
  }

  private async resolveActiveStore(): Promise<{ id: string }> {
    const stores = await this.prisma.store.findMany({
      where: { active: true },
      select: { id: true },
      take: 2,
    });

    if (stores.length !== 1) {
      throw new AppException(
        500,
        'configuration_error',
        'The system requires exactly one active store',
      );
    }

    return stores[0];
  }

  private async verifyAgainstDummy(pin: string): Promise<void> {
    const dummyHash =
      this.pinHasher.dummyHash ||
      (await this.pinHasher.hash('dummy-pin-timing-equalizer'));
    await this.pinHasher.verify(dummyHash, pin);
  }

  private invalidCredentials(): AppException {
    return new AppException(
      401,
      'invalid_credentials',
      INVALID_CREDENTIALS_MESSAGE,
    );
  }

  private toLoginResponse(result: LoginResult): LoginResponseDto {
    return {
      access_token: result.token.accessToken,
      token_type: 'Bearer',
      expires_in: result.token.expiresIn,
      staff: this.toAuthStaff(result.staff),
    };
  }

  private toAuthStaff(staff: AuthStaff): AuthStaff {
    return {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      store_id: staff.store_id,
      must_change_pin: staff.must_change_pin,
    };
  }
}
