import { describe, expect, it } from 'vitest';

import { maskPhone, normalizeNigerianPhone } from './phone.js';

const VALID_PHONES = [
  '08031234567',
  '8031234567',
  '2348031234567',
  '+2348031234567',
  '+234 0803 123 4567',
  '0803 123 4567',
  '0803-123-4567',
  '(0803) 123.4567',
  '  08031234567  ',
  '07012345678',
  '09012345678',
  '08111234567',
  '09112345678',
  '07112345678',
];

describe('normalizeNigerianPhone', () => {
  it.each(VALID_PHONES)('normalizes %s to +234 E.164', (input) => {
    expect(normalizeNigerianPhone(input)).toBe('+2348031234567'.replace(
      '8031234567',
      input.replace(/\D/g, '').slice(-10).replace(/^0/, ''),
    ));
  });

  it.each(VALID_PHONES)('is idempotent for %s', (input) => {
    const normalized = normalizeNigerianPhone(input);
    expect(normalized).not.toBeNull();
    expect(normalizeNigerianPhone(normalized as string)).toBe(normalized);
  });

  it.each([
    '06031234567',
    '0803123456',
    '080312345678',
    '+2341031234567',
    '+447911123456',
    '0803123456a',
    'abc',
    '',
    '   ',
  ])('rejects invalid input %j', (input) => {
    expect(normalizeNigerianPhone(input)).toBeNull();
  });

  it('rejects null and undefined runtime inputs', () => {
    expect(normalizeNigerianPhone(null as unknown as string)).toBeNull();
    expect(normalizeNigerianPhone(undefined as unknown as string)).toBeNull();
  });
});

describe('maskPhone', () => {
  it('masks the middle digits of a normalized phone', () => {
    const masked = maskPhone('+2348031234567');

    expect(masked).toBe('+234803****567');
    expect(masked).not.toContain('123');
  });
});
