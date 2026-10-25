import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class ListShiftsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staff_id?: string;

  @ApiPropertyOptional({ description: 'Inclusive date in the store timezone' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive date in the store timezone' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Last shift id from the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
