import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { StaffRole } from '../../../generated/prisma/enums.js';

export class AuditLogActorDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  staff_code: string;

  @ApiProperty({ enum: ['cashier', 'manager', 'admin'] })
  role: StaffRole;
}

export class AuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty()
  action: string;

  @ApiProperty()
  entity_type: string;

  @ApiPropertyOptional({ nullable: true })
  entity_id: string | null;

  @ApiPropertyOptional({ type: AuditLogActorDto, nullable: true })
  actor: AuditLogActorDto | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  details: Record<string, unknown> | null;
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  data: AuditLogResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  next_cursor: string | null;
}

export class AuditLogActionsResponseDto {
  @ApiProperty({ type: [String] })
  actions: string[];
}
