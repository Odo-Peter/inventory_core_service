import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { StockMovementReason } from '../../../generated/prisma/enums.js';

const splitCsv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class ListMovementsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiPropertyOptional({
    enum: StockMovementReason,
    isArray: true,
    description: 'One or more reasons, comma-separated (e.g. sale,damage)',
  })
  @IsOptional()
  @Transform(splitCsv)
  @IsArray()
  @IsEnum(StockMovementReason, { each: true })
  reason?: StockMovementReason[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  staff_id?: string;

  @ApiPropertyOptional({
    description: 'Inclusive lower bound, ISO 8601 (e.g. 2026-11-01T00:00:00Z)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound, ISO 8601',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ description: 'Matches item name, SKU or barcode' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}
