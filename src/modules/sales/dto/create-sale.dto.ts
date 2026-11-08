import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PaymentMethod } from '../../../generated/prisma/enums.js';

export class CreateSaleItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  item_id: string;

  @ApiProperty({ minimum: 1, maximum: 100_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  quantity: number;
}

export class CreateSaleDto {
  @ApiProperty({ type: () => [CreateSaleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items: CreateSaleItemDto[];

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  pos_account_id?: string;

  @ApiProperty({
    minimum: 0,
    description: 'Client-computed total in integer kobo, used as a sanity check',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expected_total: number;

  @ApiPropertyOptional({
    minLength: 8,
    maxLength: 64,
    description: 'Repeating the same key returns the original sale',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  idempotency_key?: string;
}
