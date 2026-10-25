import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { StaffRole } from '../../../generated/prisma/enums.js';

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: StaffRole })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}
