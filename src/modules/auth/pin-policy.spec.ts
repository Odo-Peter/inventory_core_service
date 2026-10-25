import { describe, expect, it } from 'vitest';

import { PinPolicy } from './pin-policy.js';

const policy = new PinPolicy();

describe('PinPolicy', () => {
  it('accepts 4 to 6 digits for cashiers', () => {
    expect(() => policy.validate('1357', 'cashier')).not.toThrow();
    expect(() => policy.validate('13579', 'cashier')).not.toThrow();
    expect(() => policy.validate('135791', 'cashier')).not.toThrow();
  });

  it('requires exactly 6 digits for managers and admins', () => {
    expect(() => policy.validate('1357', 'manager')).toThrow();
    expect(() => policy.validate('13579', 'manager')).toThrow();
    expect(() => policy.validate('135791', 'manager')).not.toThrow();
    expect(() => policy.validate('135791', 'admin')).not.toThrow();
  });

  it('rejects repeated and sequential PINs', () => {
    for (const pin of ['0000', '111111', '1234', '123456', '4321', '654321']) {
      expect(() => policy.validate(pin, 'cashier')).toThrow();
    }
  });

  it('rejects non-digit and out-of-range PINs', () => {
    for (const pin of ['12a4', '123', '1234567', '']) {
      expect(() => policy.validate(pin, 'cashier')).toThrow();
    }
  });

  it('generates 6-digit PINs that pass the policy', () => {
    for (let index = 0; index < 100; index += 1) {
      const pin = policy.generate();
      expect(pin).toMatch(/^\d{6}$/);
      expect(() => policy.validate(pin, 'admin')).not.toThrow();
    }
  });
});
