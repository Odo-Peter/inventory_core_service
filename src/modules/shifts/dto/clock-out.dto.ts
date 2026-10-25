import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ClockOutDto {
  @ApiProperty({ description: 'Counted cash in minor units' })
  @IsInt()
  @Min(0)
  closing_cash_counted: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  closing_notes?: string;
}
