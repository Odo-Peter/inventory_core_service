import { ApiProperty } from '@nestjs/swagger';

import type { StaffRole } from '../../../generated/prisma/enums.js';

export class StaffResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  staff_code: string;

  @ApiProperty()
  first_name: string;

  @ApiProperty()
  last_name: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: ['cashier', 'manager', 'admin'] })
  role: StaffRole;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  must_change_pin: boolean;

  @ApiProperty()
  is_locked: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class StaffWithTemporaryPinDto {
  @ApiProperty({ type: StaffResponseDto })
  staff: StaffResponseDto;

  @ApiProperty({
    description: 'Shown once. The staff member must change it at next login.',
  })
  temporary_pin: string;
}
