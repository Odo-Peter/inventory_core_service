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

export class CreateStaffDto {
  @ApiProperty({ example: 'CASHIER001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  staff_code: string;

  @ApiProperty({ example: 'Ada Okafor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    enum: StaffRole,
    default: StaffRole.cashier,
  })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}
