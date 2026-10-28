import type { Prisma } from '../../generated/prisma/client.js';
import type { StaffRole } from '../../generated/prisma/enums.js';
import { staffDisplayName } from '../users/staff.mapper.js';
import { redactAuditDetails } from './audit-details.js';
import type {
  AuditLogActorDto,
  AuditLogResponseDto,
} from './dto/audit-log-response.dto.js';

export interface AuditLogWithActor {
  id: string;
  created_at: Date;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Prisma.JsonValue;
  staff: {
    id: string;
    first_name: string;
    last_name: string;
    staff_code: string;
    role: StaffRole;
  } | null;
}

export function toAuditLogResponse(
  log: AuditLogWithActor,
): AuditLogResponseDto {
  const actor: AuditLogActorDto | null = log.staff
    ? {
        id: log.staff.id,
        name: staffDisplayName(log.staff),
        staff_code: log.staff.staff_code,
        role: log.staff.role,
      }
    : null;

  return {
    id: log.id,
    created_at: log.created_at,
    action: log.action,
    entity_type: log.entity_type,
    entity_id: log.entity_id,
    actor,
    details: redactAuditDetails(log.details),
  };
}
