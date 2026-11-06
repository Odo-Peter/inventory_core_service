import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '../../../common/pagination/pagination.js';
import { ListMovementsQueryDto } from './list-movements-query.dto.js';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '22222222-2222-4222-8222-222222222222';

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(ListMovementsQueryDto, payload);
  const errors = await validate(instance);

  return { instance, errors };
}

function propertiesWithErrors(
  errors: Awaited<ReturnType<typeof validateDto>>['errors'],
): string[] {
  return errors.map((error) => error.property);
}

describe('ListMovementsQueryDto.reason', () => {
  it('splits a comma-separated string into a list', async () => {
    const { instance, errors } = await validateDto({ reason: 'sale,damage' });

    expect(errors).toHaveLength(0);
    expect(instance.reason).toEqual(['sale', 'damage']);
  });

  it('trims values and drops whitespace-only segments', async () => {
    const { instance, errors } = await validateDto({
      reason: ' sale ,  damage ,,   ',
    });

    expect(errors).toHaveLength(0);
    expect(instance.reason).toEqual(['sale', 'damage']);
  });

  it('accepts a single reason value', async () => {
    const { instance, errors } = await validateDto({ reason: 'adjustment' });

    expect(errors).toHaveLength(0);
    expect(instance.reason).toEqual(['adjustment']);
  });

  it('rejects an invalid reason in the list', async () => {
    const { errors } = await validateDto({ reason: 'sale,oops' });

    expect(propertiesWithErrors(errors)).toContain('reason');
  });

  it('rejects a non-string, non-array reason', async () => {
    const { errors } = await validateDto({ reason: 42 });

    expect(propertiesWithErrors(errors)).toContain('reason');
  });
});

describe('ListMovementsQueryDto identifiers', () => {
  it.each(['item_id', 'staff_id'])('accepts a UUID %s', async (field) => {
    const { errors } = await validateDto({
      [field]: field === 'item_id' ? ITEM_ID : STAFF_ID,
    });

    expect(errors).toHaveLength(0);
  });

  it.each(['item_id', 'staff_id'])('rejects a non-UUID %s', async (field) => {
    const { errors } = await validateDto({ [field]: 'not-a-uuid' });

    expect(propertiesWithErrors(errors)).toContain(field);
  });

  it('allows both identifiers to be omitted', async () => {
    const { errors } = await validateDto({});

    expect(errors).toHaveLength(0);
  });
});

describe('ListMovementsQueryDto date filters', () => {
  it.each([
    '2026-11-01T00:00:00Z',
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00+01:00',
  ])('accepts the ISO 8601 datetime %s', async (value) => {
    const from = await validateDto({ from: value });
    const to = await validateDto({ to: value });

    expect(from.errors).toHaveLength(0);
    expect(to.errors).toHaveLength(0);
  });

  it.each([
    ['from', 'garbage'],
    ['to', 'garbage'],
    ['from', 123],
    ['to', 123],
  ])('rejects the invalid %s value %j', async (field, value) => {
    const { errors } = await validateDto({ [field]: value });

    expect(propertiesWithErrors(errors)).toContain(field);
  });

  it.fails(
    'rejects a date-only from value (known gap: currently accepted)',
    async () => {
      const { errors } = await validateDto({ from: '2026-11-01' });

      expect(propertiesWithErrors(errors)).toContain('from');
    },
  );
});

describe('ListMovementsQueryDto.search', () => {
  it('trims surrounding whitespace', async () => {
    const { instance, errors } = await validateDto({ search: '  coca cola  ' });

    expect(errors).toHaveLength(0);
    expect(instance.search).toBe('coca cola');
  });

  it('accepts a search of exactly 100 characters', async () => {
    const { errors } = await validateDto({ search: 'a'.repeat(100) });

    expect(errors).toHaveLength(0);
  });

  it('rejects a search longer than 100 characters', async () => {
    const { errors } = await validateDto({ search: 'a'.repeat(101) });

    expect(propertiesWithErrors(errors)).toContain('search');
  });

  it('rejects a non-string search', async () => {
    const { errors } = await validateDto({ search: 42 });

    expect(propertiesWithErrors(errors)).toContain('search');
  });
});

describe('ListMovementsQueryDto pagination', () => {
  it('inherits page defaults', async () => {
    const { instance, errors } = await validateDto({});

    expect(errors).toHaveLength(0);
    expect(instance.page).toBe(DEFAULT_PAGE);
    expect(instance.page_size).toBe(DEFAULT_PAGE_SIZE);
  });

  it('transforms numeric strings into numbers', async () => {
    const { instance, errors } = await validateDto({
      page: '2',
      page_size: '10',
    });

    expect(errors).toHaveLength(0);
    expect(instance.page).toBe(2);
    expect(instance.page_size).toBe(10);
  });

  it.each([
    ['page', 0],
    ['page', 1.5],
    ['page_size', 0],
    ['page_size', 101],
  ])('rejects an invalid %s value %j', async (field, value) => {
    const { errors } = await validateDto({ [field]: value });

    expect(propertiesWithErrors(errors)).toContain(field);
  });
});
