import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import { NIGERIAN_PHONE_E164, normalizeNigerianPhone } from './phone.js';

export function IsNigerianPhone() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string'
        ? (normalizeNigerianPhone(value) ?? value)
        : value,
    ),
    Matches(NIGERIAN_PHONE_E164, {
      message: 'phone must be a valid Nigerian mobile number, e.g. 08031234567',
    }),
  );
}
