import type { ArgumentMetadata } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { VALIDATION_PIPE_OPTIONS } from '../../../app.setup.js';
import { CreateStaffDto } from './create-staff.dto.js';
import { UpdateStaffDto } from './update-staff.dto.js';

const VALID_CREATE = {
  first_name: 'Ada',
  last_name: 'Okafor',
  phone: '08031234567',
};

async function validateDto<T extends object>(
  type: new () => T,
  payload: Record<string, unknown>,
) {
  const instance = plainToInstance(type, payload);
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return { instance, errors };
}

function bodyMetadata(metatype: new () => unknown): ArgumentMetadata {
  return { type: 'body', metatype };
}

describe('CreateStaffDto', () => {
  it.each(['first_name', 'last_name', 'phone'])(
    'rejects a payload without %s',
    async (field) => {
      const payload = { ...VALID_CREATE };
      delete payload[field as keyof typeof payload];

      const { errors } = await validateDto(CreateStaffDto, payload);

      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it.each([
    ['first_name', ''],
    ['first_name', '   '],
    ['last_name', ''],
    ['last_name', '   '],
  ])('rejects an empty or whitespace-only %s', async (field, value) => {
    const { errors } = await validateDto(CreateStaffDto, {
      ...VALID_CREATE,
      [field]: value,
    });

    expect(errors.some((error) => error.property === field)).toBe(true);
  });

  it('trims first_name and last_name', async () => {
    const { instance, errors } = await validateDto(CreateStaffDto, {
      ...VALID_CREATE,
      first_name: '  Ada  ',
      last_name: '\tOkafor\n',
    });

    expect(errors).toHaveLength(0);
    expect(instance.first_name).toBe('Ada');
    expect(instance.last_name).toBe('Okafor');
  });

  it.each(['first_name', 'last_name'])(
    'rejects %s longer than 120 characters',
    async (field) => {
      const { errors } = await validateDto(CreateStaffDto, {
        ...VALID_CREATE,
        [field]: 'a'.repeat(121),
      });

      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );

  it.each([
    '08031234567',
    '8031234567',
    '2348031234567',
    '+2348031234567',
    '+234 0803 123 4567',
    '0803 123 4567',
    '0803-123-4567',
    '(0803) 123.4567',
    '  08031234567  ',
  ])('normalizes a valid phone %j to +234 E.164', async (phone) => {
    const { instance, errors } = await validateDto(CreateStaffDto, {
      ...VALID_CREATE,
      phone,
    });

    expect(errors).toHaveLength(0);
    expect(instance.phone).toBe('+2348031234567');
  });

  it('rejects an invalid phone with the Nigerian-phone message', async () => {
    const { errors } = await validateDto(CreateStaffDto, {
      ...VALID_CREATE,
      phone: '06031234567',
    });
    const phoneError = errors.find((error) => error.property === 'phone');

    expect(phoneError).toBeDefined();
    expect(phoneError?.constraints?.matches).toContain(
      'valid Nigerian mobile number',
    );
  });

  it('does not define a name property', async () => {
    const { errors } = await validateDto(CreateStaffDto, {
      ...VALID_CREATE,
      name: 'Ada Okafor',
    });

    expect(errors.some((error) => error.property === 'name')).toBe(true);
  });
});

describe('UpdateStaffDto', () => {
  it('accepts an empty object', async () => {
    const { errors } = await validateDto(UpdateStaffDto, {});

    expect(errors).toHaveLength(0);
  });

  it.each([
    ['first_name', 'Ada'],
    ['last_name', 'Okafor'],
    ['phone', '08031234567'],
    ['role', 'manager'],
  ])('validates %s independently', async (field, value) => {
    const { errors } = await validateDto(UpdateStaffDto, {
      [field]: value,
    });

    expect(errors).toHaveLength(0);
  });

  it('makes phone optional and normalizes it when provided', async () => {
    const withoutPhone = await validateDto(UpdateStaffDto, {
      first_name: 'Ada',
    });
    expect(withoutPhone.errors).toHaveLength(0);

    const withPhone = await validateDto(UpdateStaffDto, {
      phone: '0803 123 4567',
    });
    expect(withPhone.errors).toHaveLength(0);
    expect(withPhone.instance.phone).toBe('+2348031234567');
  });

  it('rejects an invalid phone', async () => {
    const { errors } = await validateDto(UpdateStaffDto, {
      phone: '+447911123456',
    });

    expect(errors.some((error) => error.property === 'phone')).toBe(true);
  });

  it('trims names and rejects empty names', async () => {
    const trimmed = await validateDto(UpdateStaffDto, {
      first_name: '  Ada  ',
      last_name: '  Okafor  ',
    });
    expect(trimmed.errors).toHaveLength(0);
    expect(trimmed.instance.first_name).toBe('Ada');
    expect(trimmed.instance.last_name).toBe('Okafor');

    const empty = await validateDto(UpdateStaffDto, { first_name: '   ' });
    expect(empty.errors.some((error) => error.property === 'first_name')).toBe(
      true,
    );
  });
});

describe('global ValidationPipe options', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  it('rejects an unknown name field on create', async () => {
    await expect(
      pipe.transform(
        { ...VALID_CREATE, name: 'Ada Okafor' },
        bodyMetadata(CreateStaffDto),
      ),
    ).rejects.toThrow();
  });

  it('rejects unknown fields on update', async () => {
    await expect(
      pipe.transform(
        { first_name: 'Ada', nickname: 'Ada' },
        bodyMetadata(UpdateStaffDto),
      ),
    ).rejects.toThrow();
  });

  it('transform normalizes the phone before it reaches the service', async () => {
    const result = (await pipe.transform(
      { ...VALID_CREATE, phone: '0803 123 4567' },
      bodyMetadata(CreateStaffDto),
    )) as CreateStaffDto;

    expect(result.phone).toBe('+2348031234567');
  });
});
