import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from './pagination.js';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE,
    minimum: 1,
    maximum: MAX_PAGE,
    description: `Page number (1-based, maximum ${MAX_PAGE})`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    description: `Rows per page (maximum ${MAX_PAGE_SIZE})`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  page_size: number = DEFAULT_PAGE_SIZE;
}
