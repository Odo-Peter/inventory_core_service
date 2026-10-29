import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCategoryDto {
  @ApiProperty({ example: 'Beverages' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Beverages' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CategoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class CategoryListResponseDto extends PaginatedResponseDto<CategoryResponseDto> {}
