export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE = 10_000;
export const MAX_PAGE_SIZE = 100;

export interface PageMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface SkipTake {
  skip: number;
  take: number;
}

export function toSkipTake(page: number, pageSize: number): SkipTake {
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function buildPageMeta(
  total: number,
  page: number,
  pageSize: number,
): PageMeta {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: Math.ceil(total / pageSize),
  };
}
