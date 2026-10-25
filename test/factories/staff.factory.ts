import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';

import type { StaffRole } from '../../src/generated/prisma/enums.js';
import type { StaffModel } from '../../src/generated/prisma/models.js';
import type { PinHasherService } from '../../src/modules/auth/pin-hasher.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

const DEFAULT_PIN = '246810';
const PHONE_PREFIX = '803';

let staffSequence = 0;

export interface StaffInput {
  staff_code: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: StaffRole;
  pin: string;
}

export interface CreateStaffOptions extends Partial<StaffInput> {
  staffCode?: string;
  active?: boolean;
  mustChangePin?: boolean;
}

export interface StaffFactoryContext {
  app: INestApplication;
  prisma: PrismaService;
  pinHasher: PinHasherService;
}

function nextPhone(sequence: number): string {
  return `+234${PHONE_PREFIX}${sequence.toString().padStart(7, '0').slice(-7)}`;
}

export function buildStaffInput(
  overrides: Partial<StaffInput> = {},
): StaffInput {
  staffSequence += 1;

  return {
    staff_code:
      overrides.staff_code ?? `STAFF${staffSequence.toString().padStart(4, '0')}`,
    first_name: overrides.first_name ?? 'Test',
    last_name: overrides.last_name ?? 'Staff',
    phone: overrides.phone ?? nextPhone(staffSequence),
    role: overrides.role ?? 'cashier',
    pin: overrides.pin ?? DEFAULT_PIN,
  };
}

export async function createStaff(
  context: Pick<StaffFactoryContext, 'prisma' | 'pinHasher'>,
  storeId: string,
  options: CreateStaffOptions = {},
): Promise<StaffModel> {
  const input = buildStaffInput({
    staff_code: options.staff_code ?? options.staffCode,
    first_name: options.first_name,
    last_name: options.last_name,
    phone: options.phone,
    role: options.role,
    pin: options.pin,
  });
  const pinHash = await context.pinHasher.hash(input.pin);

  return context.prisma.staff.create({
    data: {
      store_id: storeId,
      staff_code: input.staff_code,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      role: input.role,
      pin_hash: pinHash,
      active: options.active ?? true,
      must_change_pin: options.mustChangePin ?? false,
    },
  });
}

export function login(
  app: INestApplication,
  staffCode: string,
  pin = DEFAULT_PIN,
) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ staff_code: staffCode, pin });
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function loginAs(
  context: Pick<StaffFactoryContext, 'app'>,
  staffCode: string,
  pin = DEFAULT_PIN,
): Promise<{ token: string; staffId: string }> {
  const response = await login(context.app, staffCode, pin);
  expect(response.status).toBe(200);

  const token = response.body.access_token as string;
  return { token, staffId: response.body.staff.id as string };
}
