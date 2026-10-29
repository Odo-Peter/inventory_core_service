import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
};

const normaliseName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateItemDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Exact scan code. An empty string is stored as null.',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiProperty({ example: 'Coca-Cola 50cl' })
  @Transform(normaliseName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @ApiProperty({ example: 'piece' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unit: string;

  @ApiProperty({ description: 'Selling price in integer minor units' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  current_price: number;

  @ApiPropertyOptional({
    description: 'Cost price in integer minor units (manager/admin only)',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cost_price?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorder_threshold?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

export class UpdateItemDto {
  @ApiPropertyOptional({ example: 'COKE-50CL' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @ApiPropertyOptional({ example: 'Coca-Cola 50cl' })
  @IsOptional()
  @Transform(normaliseName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  category_id?: string | null;

  @ApiPropertyOptional({ example: 'piece' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  unit?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  cost_price?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  reorder_threshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ChangeItemPriceDto {
  @ApiProperty({ description: 'New selling price in integer minor units' })
  @IsInt()
  @Min(0)
  new_price: number;
}

export class ListItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive search over name, SKU and barcode',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Only items with stock at or below a positive reorder threshold',
  })
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  low_stock?: boolean;
}

export class ItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  sku: string;

  @ApiPropertyOptional({ nullable: true })
  barcode: string | null;

  @ApiPropertyOptional({ nullable: true })
  image_key: string | null;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  category_id: string | null;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  current_price: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Omitted entirely for cashiers',
  })
  cost_price?: number | null;

  @ApiProperty({ description: 'Read-only stock quantity cache' })
  stock_quantity: number;

  @ApiProperty()
  reorder_threshold: number;

  @ApiProperty()
  active: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: Date;
}

export class ItemListResponseDto extends PaginatedResponseDto<ItemResponseDto> {}

export class PriceHistoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  item_id: string;

  @ApiProperty()
  old_price: number;

  @ApiProperty()
  new_price: number;

  @ApiPropertyOptional({ nullable: true })
  changed_by_staff_id: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  changed_at: Date;
}

export class PriceHistoryListResponseDto extends PaginatedResponseDto<PriceHistoryResponseDto> {}
