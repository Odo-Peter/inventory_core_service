import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { StaffRole } from '../../../generated/prisma/enums.js';
import { IsNigerianPhone } from '../phone.decorator.js';

export class CreateStaffDto {
  @ApiProperty({ example: 'CASHIER001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  staff_code: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  first_name: string;

  @ApiProperty({ example: 'Okafor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  last_name: string;

  @ApiProperty({
    example: '08031234567',
    description:
      'Nigerian mobile number. Accepts 0803…, 234803… or +234803…; stored as +234XXXXXXXXXX.',
  })
  @IsString()
  @IsNotEmpty()
  @IsNigerianPhone()
  phone: string;

  @ApiPropertyOptional({
    enum: StaffRole,
    default: StaffRole.cashier,
  })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}
