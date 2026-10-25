import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ClockInDto {
  @ApiProperty({ description: 'Opening float in minor units' })
  @IsInt()
  @Min(0)
  opening_float: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  opening_notes?: string;
}
