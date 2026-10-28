import { describe, expect, it } from 'vitest';

import { buildPageMeta, toSkipTake } from './pagination.js';

describe('pagination helpers', () => {
  it('calculates skip and take for the first page', () => {
    expect(toSkipTake(1, 25)).toEqual({ skip: 0, take: 25 });
  });

  it('calculates skip and take for a middle page', () => {
    expect(toSkipTake(2, 10)).toEqual({ skip: 10, take: 10 });
  });

  it('calculates skip and take for the maximum supported page', () => {
    expect(toSkipTake(10_000, 100)).toEqual({ skip: 999_900, take: 100 });
  });

  it('calculates total pages for exact multiples', () => {
    expect(buildPageMeta(40, 2, 20)).toEqual({
      page: 2,
      page_size: 20,
      total: 40,
      total_pages: 2,
    });
  });

  it('rounds total pages up for remainders', () => {
    expect(buildPageMeta(41, 1, 20)).toEqual({
      page: 1,
      page_size: 20,
      total: 41,
      total_pages: 3,
    });
  });

  it('returns zero total pages for an empty result', () => {
    expect(buildPageMeta(0, 1, 25)).toEqual({
      page: 1,
      page_size: 25,
      total: 0,
      total_pages: 0,
    });
  });
});
