import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from './pagination.js';
import { PaginationQueryDto } from './pagination-query.dto.js';

async function validateQuery(
  value: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(PaginationQueryDto, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return errors.map((error) => error.property);
}

describe('PaginationQueryDto', () => {
  it('applies defaults when parameters are omitted', async () => {
    const dto = plainToInstance(PaginationQueryDto, {});

    expect(dto.page).toBe(DEFAULT_PAGE);
    expect(dto.page_size).toBe(DEFAULT_PAGE_SIZE);
    expect(await validate(dto)).toEqual([]);
  });

  it('transforms numeric strings', async () => {
    const dto = plainToInstance(PaginationQueryDto, {
      page: '2',
      page_size: '50',
    });

    expect(dto).toEqual({ page: 2, page_size: 50 });
    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    ['page', 0],
    ['page', -1],
    ['page', 1.5],
    ['page', 'abc'],
    ['page', MAX_PAGE + 1],
  ])('rejects invalid %s value %s', async (property, value) => {
    expect(await validateQuery({ [property]: value })).toContain(property);
  });

  it.each([
    ['page_size', 0],
    ['page_size', -1],
    ['page_size', 1.5],
    ['page_size', 'abc'],
    ['page_size', MAX_PAGE_SIZE + 1],
  ])('rejects invalid %s value %s', async (property, value) => {
    expect(await validateQuery({ [property]: value })).toContain(property);
  });
});
