import { describe, expect, it } from 'vitest';

import type { StaffModel } from '../../generated/prisma/models.js';
import { toStaffResponse } from './staff.mapper.js';

const staff: StaffModel = {
  id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  staff_code: 'CASH001',
  first_name: 'Ada',
  last_name: 'Okafor',
  phone: '+2348031234567',
  pin_hash: 'secret-hash',
  role: 'cashier',
  active: true,
  failed_pin_attempts: 3,
  locked_until: new Date('2026-10-25T12:05:00.000Z'),
  token_version: 7,
  must_change_pin: false,
  created_at: new Date('2026-10-25T10:00:00.000Z'),
  updated_at: new Date('2026-10-25T11:00:00.000Z'),
};

describe('toStaffResponse', () => {
  it('maps names, phone and the computed display name', () => {
    const response = toStaffResponse(
      staff,
      new Date('2026-10-25T12:00:00.000Z'),
    );

    expect(response).toMatchObject({
      first_name: 'Ada',
      last_name: 'Okafor',
      phone: '+2348031234567',
      name: 'Ada Okafor',
      is_locked: true,
    });
  });

  it('returns exactly the documented keys', () => {
    const response = toStaffResponse(staff);

    expect(Object.keys(response)).toEqual([
      'id',
      'store_id',
      'staff_code',
      'first_name',
      'last_name',
      'phone',
      'name',
      'role',
      'active',
      'must_change_pin',
      'is_locked',
      'created_at',
      'updated_at',
    ]);
  });

  it('never exposes secret columns', () => {
    const serialized = JSON.stringify(toStaffResponse(staff));

    expect(serialized).not.toContain('pin_hash');
    expect(serialized).not.toContain('token_version');
    expect(serialized).not.toContain('failed_pin_attempts');
    expect(serialized).not.toContain('locked_until');
    expect(serialized).not.toContain('secret-hash');
  });
});
