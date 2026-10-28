import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { AUDIT_ACTIONS, type AuditAction } from '../audit-actions.js';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AUDIT_ACTIONS) })
  @IsOptional()
  @IsIn(Object.values(AUDIT_ACTIONS))
  action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  entity_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entity_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staff_id?: string;

  @ApiPropertyOptional({
    description: 'Inclusive ISO 8601 lower bound for created_at',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'Exclusive ISO 8601 upper bound for created_at',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor from the previous page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
