import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { POSAccountType } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const parseBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
};

export class CreatePosAccountDto {
  @ApiProperty({ example: 'Front Counter POS' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @ApiProperty({ enum: POSAccountType })
  @IsEnum(POSAccountType)
  type: POSAccountType;

  @ApiPropertyOptional({
    description: 'Label-level hint only, e.g. "GTBank ending 4821"',
    nullable: true,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  details?: string | null;
}

export class UpdatePosAccountDto {
  @ApiPropertyOptional({ example: 'Front Counter POS' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ enum: POSAccountType })
  @IsOptional()
  @IsEnum(POSAccountType)
  type?: POSAccountType;

  @ApiPropertyOptional({
    description: 'Label-level hint only; send null to clear',
    nullable: true,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  details?: string | null;
}

export class ListPosAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: POSAccountType })
  @IsOptional()
  @IsEnum(POSAccountType)
  type?: POSAccountType;
}

export class PosAccountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  label: string;

  @ApiProperty({ enum: POSAccountType })
  type: POSAccountType;

  @ApiPropertyOptional({ nullable: true })
  details: string | null;

  @ApiProperty()
  active: boolean;

  @ApiPropertyOptional({ nullable: true })
  created_by_staff_id: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class PosAccountListResponseDto extends PaginatedResponseDto<PosAccountResponseDto> {}
