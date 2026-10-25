import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { StaffRole } from '../../../generated/prisma/enums.js';
import { IsNigerianPhone } from '../phone.decorator.js';
import { Transform } from 'class-transformer';

export class UpdateStaffDto {
  @ApiPropertyOptional({ example: 'Ada' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  first_name?: string;

  @ApiPropertyOptional({ example: 'Okafor' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  last_name?: string;

  @ApiPropertyOptional({ example: '08031234567' })
  @IsOptional()
  @IsString()
  @IsNigerianPhone()
  phone?: string;

  @ApiPropertyOptional({ enum: StaffRole })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}
