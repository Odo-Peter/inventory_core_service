import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { StaffRole } from '../../../generated/prisma/enums.js';
import { IsNigerianPhone } from '../phone.decorator.js';

export class CreateStaffDto {
  @ApiProperty({ example: 'Ada' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(120)
  first_name: string;

  @ApiProperty({ example: 'Okafor' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
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
