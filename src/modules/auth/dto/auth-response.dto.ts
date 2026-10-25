import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { StaffRole } from '../../../generated/prisma/enums.js';

export class AuthStaffDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    readOnly: true,
    description: 'Computed from first_name and last_name.',
  })
  name: string;

  @ApiProperty()
  first_name: string;

  @ApiProperty()
  last_name: string;

  @ApiProperty({ enum: ['cashier', 'manager', 'admin'] })
  role: StaffRole;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  must_change_pin: boolean;
}

export class LoginResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: string;

  @ApiProperty({ example: 28800 })
  expires_in: number;

  @ApiProperty({ type: AuthStaffDto })
  staff: AuthStaffDto;
}

export class MeResponseDto extends AuthStaffDto {
  @ApiPropertyOptional({ nullable: true })
  active_shift_id: string | null;
}

export class LogoutResponseDto {
  @ApiProperty()
  success: boolean;
}
