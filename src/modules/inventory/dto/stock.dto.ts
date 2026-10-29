import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';
import type { StockMovementReason } from '../../../generated/prisma/enums.js';

class StockNoteDto {
  @ApiPropertyOptional({ description: 'Optional note; reason is required' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  note?: string;
}

export class InitialStockDto extends StockNoteDto {
  @ApiProperty({ description: 'Opening quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReceiveStockDto extends StockNoteDto {
  @ApiProperty({ description: 'Received quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Recorded in audit details only; no supplier table',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  supplier_name?: string;

  @ApiPropertyOptional({
    description: 'Recorded in audit details only; no delivery table',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  delivery_reference?: string;
}

export class AdjustStockDto extends StockNoteDto {
  @ApiProperty({
    description: 'Signed quantity change; must be non-zero',
    example: -3,
  })
  @IsInt()
  @NotEquals(0)
  quantity_change: number;
}

export class DamageStockDto extends StockNoteDto {
  @ApiProperty({
    description: 'Damaged quantity (stored as negative)',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class StockMovementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  item_id: string;

  @ApiProperty()
  quantity_change: number;

  @ApiProperty({
    enum: ['initial', 'restock', 'sale', 'refund', 'adjustment', 'damage'],
  })
  reason: StockMovementReason;

  @ApiPropertyOptional({ nullable: true })
  sale_id: string | null;

  @ApiPropertyOptional({ nullable: true })
  refund_id: string | null;

  @ApiPropertyOptional({ nullable: true })
  staff_id: string | null;

  @ApiPropertyOptional({ nullable: true })
  note: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;
}

export class StockMovementListResponseDto extends PaginatedResponseDto<StockMovementResponseDto> {}

export class ReconciliationItemDto {
  @ApiProperty()
  item_id: string;

  @ApiProperty()
  sku: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  stock_quantity: number;

  @ApiProperty()
  movement_total: number;

  @ApiProperty()
  difference: number;
}

export class StockStatusResponseDto {
  @ApiProperty()
  item_id: string;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  stock_quantity: number;

  @ApiProperty()
  has_movements: boolean;

  @ApiProperty()
  opening_stock_allowed: boolean;

  @ApiProperty()
  receive_allowed: boolean;
}
export class ReconciliationListResponseDto extends PaginatedResponseDto<ReconciliationItemDto> {}
