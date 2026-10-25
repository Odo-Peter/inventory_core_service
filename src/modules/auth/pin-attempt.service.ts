import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AUDIT_ACTIONS } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { calculateLockout } from './auth.config.js';

@Injectable()
export class PinAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async recordFailure(
    staffId: string,
    storeId: string,
    now: Date,
    reason?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ failed_pin_attempts: number }>>`
        UPDATE "Staff"
        SET "failed_pin_attempts" = "failed_pin_attempts" + 1
        WHERE "id" = ${staffId}::uuid
        RETURNING "failed_pin_attempts"
      `;

      const failedAttempts = rows[0]?.failed_pin_attempts ?? 1;
      const lockout = calculateLockout(
        failedAttempts,
        this.config.lockoutThreshold,
        this.config.lockoutMinutes,
        now,
      );

      if (lockout) {
        await tx.staff.update({
          where: { id: staffId },
          data: { locked_until: lockout.lockedUntil },
        });
      }

      await this.audit.record(
        {
          store_id: storeId,
          staff_id: staffId,
          action: AUDIT_ACTIONS.loginFailed,
          entity_type: 'Staff',
          entity_id: staffId,
          details: {
            failed_attempts: failedAttempts,
            ...(reason ? { reason } : {}),
          },
        },
        tx,
      );

      if (lockout) {
        await this.audit.record(
          {
            store_id: storeId,
            staff_id: staffId,
            action: AUDIT_ACTIONS.accountLocked,
            entity_type: 'Staff',
            entity_id: staffId,
            details: {
              failed_attempts: failedAttempts,
              tier: lockout.tier,
            },
          },
          tx,
        );
      }
    });
  }
}
