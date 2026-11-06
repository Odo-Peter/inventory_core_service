import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ITEM_UNITS, ItemUnit } from '../item-unit.enum.js';
import { CreateItemDto, UpdateItemDto } from './item.dto.js';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

const VALID_CREATE = {
  name: 'Coca-Cola 50cl',
  unit: ItemUnit.BOTTLE,
  current_price: 1_000,
};

async function validateDto<T extends object>(
  type: new () => T,
  payload: Record<string, unknown>,
) {
  const instance = plainToInstance(type, payload);
  const errors = await validate(instance);

  return { instance, errors };
}

function propertiesWithErrors(errors: Awaited<ReturnType<typeof validateDto>>['errors']): string[] {
  return errors.map((error) => error.property);
}

describe('CreateItemDto.unit', () => {
  it.each(Object.values(ItemUnit))('accepts the %s unit', async (unit) => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      unit,
    });

    expect(errors).toHaveLength(0);
    expect(instance.unit).toBe(unit);
  });

  it.each([
    ['an unknown unit', 'kg'],
    ['an empty unit', ''],
    ['the wrong case', 'Bottle'],
    ['null', null],
    ['a number', 12],
    ['an object', { value: 'piece' }],
  ])('rejects %s', async (_label, unit) => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      unit,
    });

    expect(propertiesWithErrors(errors)).toContain('unit');
  });

  it('lists every allowed unit in the validation message', async () => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      unit: 'kg',
    });
    const unitError = errors.find((error) => error.property === 'unit');

    expect(unitError?.constraints?.isEnum).toBe(
      `unit must be one of: ${ITEM_UNITS.join(', ')}`,
    );
  });
});

describe('CreateItemDto.name', () => {
  it('trims and collapses internal whitespace', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      name: '  Coca   Cola   50cl  ',
    });

    expect(errors).toHaveLength(0);
    expect(instance.name).toBe('Coca Cola 50cl');
  });

  it.each(['', '   '])('rejects the empty name %j', async (name) => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      name,
    });

    expect(propertiesWithErrors(errors)).toContain('name');
  });

  it('rejects a name longer than 160 characters', async () => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      name: 'a'.repeat(161),
    });

    expect(propertiesWithErrors(errors)).toContain('name');
  });
});

describe('CreateItemDto.barcode', () => {
  it('is optional when omitted', async () => {
    const { errors } = await validateDto(CreateItemDto, VALID_CREATE);

    expect(errors).toHaveLength(0);
  });

  it.each(['', '   '])('stores the empty barcode %j as null', async (barcode) => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      barcode,
    });

    expect(errors).toHaveLength(0);
    expect(instance.barcode).toBeNull();
  });

  it('trims a non-empty barcode', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      barcode: '  0123456789  ',
    });

    expect(errors).toHaveLength(0);
    expect(instance.barcode).toBe('0123456789');
  });

  it('rejects a barcode longer than 64 characters', async () => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      barcode: '1'.repeat(65),
    });

    expect(propertiesWithErrors(errors)).toContain('barcode');
  });
});

describe('CreateItemDto.category_id', () => {
  it.each([CATEGORY_ID, null, undefined])(
    'accepts the category value %j',
    async (categoryId) => {
      const { errors } = await validateDto(CreateItemDto, {
        ...VALID_CREATE,
        category_id: categoryId,
      });

      expect(errors).toHaveLength(0);
    },
  );

  it.each(['not-a-uuid', '123', 42])(
    'rejects the non-UUID category value %j',
    async (categoryId) => {
      const { errors } = await validateDto(CreateItemDto, {
        ...VALID_CREATE,
        category_id: categoryId,
      });

      expect(propertiesWithErrors(errors)).toContain('category_id');
    },
  );
});

describe('CreateItemDto prices and threshold', () => {
  it.each([0, 1, 2_500])('accepts the integer price %s', async (price) => {
    const { errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      current_price: price,
    });

    expect(errors).toHaveLength(0);
  });

  it('coerces a numeric string current_price', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      current_price: '2500',
    });

    expect(errors).toHaveLength(0);
    expect(instance.current_price).toBe(2_500);
  });

  it.each([-1, 1.5, 'abc', null])(
    'rejects the invalid current_price %j',
    async (price) => {
      const { errors } = await validateDto(CreateItemDto, {
        ...VALID_CREATE,
        current_price: price,
      });

      expect(propertiesWithErrors(errors)).toContain('current_price');
    },
  );

  it('accepts a missing or null cost_price', async () => {
    const missing = await validateDto(CreateItemDto, VALID_CREATE);
    const explicitNull = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      cost_price: null,
    });

    expect(missing.errors).toHaveLength(0);
    expect(explicitNull.errors).toHaveLength(0);
    expect(explicitNull.instance.cost_price).toBeNull();
  });

  it('coerces a numeric string cost_price', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      cost_price: '750',
    });

    expect(errors).toHaveLength(0);
    expect(instance.cost_price).toBe(750);
  });

  it.each([['cost_price', -1], ['cost_price', 1.5], ['cost_price', 'abc']] as const)(
    'rejects the invalid %s value %j',
    async (field, value) => {
      const { errors } = await validateDto(CreateItemDto, {
        ...VALID_CREATE,
        [field]: value,
      });

      expect(propertiesWithErrors(errors)).toContain(field);
    },
  );

  it('accepts a missing reorder_threshold', async () => {
    const { errors } = await validateDto(CreateItemDto, VALID_CREATE);

    expect(errors).toHaveLength(0);
  });

  it('coerces a numeric string reorder_threshold', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      reorder_threshold: '5',
    });

    expect(errors).toHaveLength(0);
    expect(instance.reorder_threshold).toBe(5);
  });

  it.each([-1, 1.5, 'abc'])(
    'rejects the invalid reorder_threshold %j',
    async (threshold) => {
      const { errors } = await validateDto(CreateItemDto, {
        ...VALID_CREATE,
        reorder_threshold: threshold,
      });

      expect(propertiesWithErrors(errors)).toContain('reorder_threshold');
    },
  );
});

describe('CreateItemDto.active', () => {
  it('keeps the boolean value true', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      active: true,
    });

    expect(errors).toHaveLength(0);
    expect(instance.active).toBe(true);
  });

  it('keeps the boolean value false', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      active: false,
    });

    expect(errors).toHaveLength(0);
    expect(instance.active).toBe(false);
  });

  it('documents the current string "false" coercion (see report)', async () => {
    const { instance, errors } = await validateDto(CreateItemDto, {
      ...VALID_CREATE,
      active: 'false',
    });

    // @Type(() => Boolean) uses Boolean(value), so the non-empty string
    // "false" becomes true. This test records current behaviour only.
    expect(errors).toHaveLength(0);
    expect(instance.active).toBe(true);
  });
});

describe('UpdateItemDto', () => {
  it('accepts an empty partial payload', async () => {
    const { errors } = await validateDto(UpdateItemDto, {});

    expect(errors).toHaveLength(0);
  });

  it('normalizes a provided name', async () => {
    const { instance, errors } = await validateDto(UpdateItemDto, {
      name: '  New   Name  ',
    });

    expect(errors).toHaveLength(0);
    expect(instance.name).toBe('New Name');
  });

  it.each(Object.values(ItemUnit))(
    'accepts the provided %s unit',
    async (unit) => {
      const { instance, errors } = await validateDto(UpdateItemDto, { unit });

      expect(errors).toHaveLength(0);
      expect(instance.unit).toBe(unit);
    },
  );

  it.each(['', '   ', 'a'.repeat(41)])(
    'rejects the invalid provided unit %j',
    async (unit) => {
      const { errors } = await validateDto(UpdateItemDto, { unit });

      expect(propertiesWithErrors(errors)).toContain('unit');
    },
  );

  it.fails(
    'rejects an unknown unit once UpdateItemDto uses ItemUnit (known gap)',
    async () => {
      const { errors } = await validateDto(UpdateItemDto, { unit: 'kg' });

      expect(propertiesWithErrors(errors)).toContain('unit');
    },
  );
});
