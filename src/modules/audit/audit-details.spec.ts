import { describe, expect, it } from 'vitest';

import { redactAuditDetails } from './audit-details.js';

describe('redactAuditDetails', () => {
  it('keeps safe values and masked phone values', () => {
    expect(
      redactAuditDetails({
        fields: ['phone'],
        phone_from: '+234803****567',
        phone_to: '+234803****999',
        phone: '+234803****123',
        reason: 'Cashier left',
      }),
    ).toEqual({
      fields: ['phone'],
      phone_from: '+234803****567',
      phone_to: '+234803****999',
      phone: '+234803****123',
      reason: 'Cashier left',
    });
  });

  it('drops forbidden keys and unmasked phone values recursively', () => {
    expect(
      redactAuditDetails({
        email: 'ada@example.com',
        token: 'secret-token',
        phone: '+2348031234567',
        phone_from: '+2348031234567',
        phone_to: '+234803****999',
        unmasked_phone: '+2348031234567',
        nested: {
          password: 'secret',
          keep: 'visible',
          list: [
            { phone_number: '+2348031234567', note: 'kept' },
            { pin_hash: 'hash', count: 2 },
          ],
        },
      }),
    ).toEqual({
      phone_to: '+234803****999',
      nested: {
        keep: 'visible',
        list: [{ note: 'kept' }, { count: 2 }],
      },
    });
  });

  it('returns null when details are missing or not an object', () => {
    expect(redactAuditDetails(null)).toBeNull();
    expect(redactAuditDetails(undefined)).toBeNull();
    expect(redactAuditDetails('text')).toBeNull();
    expect(redactAuditDetails(['phone_from'])).toBeNull();
  });
});
