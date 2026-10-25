import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ForceCloseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000)
  reason: string;

  @ApiPropertyOptional({ description: 'Counted cash in minor units' })
  @IsOptional()
  @IsInt()
  @Min(0)
  closing_cash_counted?: number;
}
