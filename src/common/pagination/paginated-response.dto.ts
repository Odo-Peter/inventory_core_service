import { ApiProperty } from '@nestjs/swagger';

import type { PageMeta } from './pagination.js';

export class PageMetaDto implements PageMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 25 })
  page_size: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 2 })
  total_pages: number;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: PageMetaDto;
}
