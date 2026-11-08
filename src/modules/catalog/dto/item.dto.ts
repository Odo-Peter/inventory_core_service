import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';
import { toBoolean } from '../../../common/validation/transformers.js';
import { ITEM_UNITS, ItemUnit } from '../item-unit.enum.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const emptyToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  @ApiProperty({
    enum: ItemUnit,
    enumName: 'ItemUnit',
    example: ItemUnit.PIECE,
  })
  @IsEnum(ItemUnit, {
    message: `unit must be one of: ${ITEM_UNITS.join(', ')}`,
  })
  unit: ItemUnit;

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
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class UpdateItemDto extends PartialType(
  OmitType(CreateItemDto, ['current_price'] as const),
  { skipNullProperties: false },
) {}

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
  @Transform(toBoolean)
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
  @Transform(toBoolean)
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

  @ApiPropertyOptional({ nullable: true })
  changed_by_name: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  changed_at: Date;
}

export class PriceHistoryListResponseDto extends PaginatedResponseDto<PriceHistoryResponseDto> {}

export class ItemUnitsResponseDto {
  @ApiProperty({ type: [String] })
  units: string[];
}
