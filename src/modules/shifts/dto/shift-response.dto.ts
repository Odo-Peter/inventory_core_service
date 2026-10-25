import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ShiftCloseReason } from '../../../generated/prisma/enums.js';

export class ShiftResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  staff_id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  clock_in_at: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  clock_out_at: Date | null;

  @ApiProperty()
  opening_float: number;

  @ApiPropertyOptional({ nullable: true })
  closing_cash_counted: number | null;

  @ApiPropertyOptional({ nullable: true })
  opening_notes: string | null;

  @ApiPropertyOptional({ nullable: true })
  closing_notes: string | null;

  @ApiPropertyOptional({ nullable: true })
  closed_by_staff_id: string | null;

  @ApiPropertyOptional({
    enum: ['normal', 'forced', 'handover'],
    nullable: true,
  })
  close_reason: ShiftCloseReason | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class ShiftListResponseDto {
  @ApiProperty({ type: [ShiftResponseDto] })
  data: ShiftResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  next_cursor: string | null;
}
