import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const parseBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
};

export class ListCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(parseBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive name search' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
}
