import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { expect } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CLOCK, type Clock } from '../../src/common/clock.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import type { StaffModel } from '../../src/generated/prisma/models.js';
import type { StaffRole } from '../../src/generated/prisma/enums.js';
import { PinHasherService } from '../../src/modules/auth/pin-hasher.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

export class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceMs(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(date: Date): void {
    this.current = date;
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  config: AppConfig;
  clock: FakeClock;
  pinHasher: PinHasherService;
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    corsOrigins: ['http://localhost:5173'],
    jwtSecret: 'test-jwt-secret-with-at-least-32-bytes',
    jwtIssuer: 'inventory-core-test',
    jwtAudience: 'inventory-pos-test',
    jwtAccessTtlSeconds: 3_600,
    pinPepper: 'test-pin-pepper-with-16-bytes',
    lockoutThreshold: 5,
    lockoutMinutes: [5, 15, 60],
    loginThrottleIpPerMin: 10_000,
    loginThrottleCodePerMin: 10_000,
    ...overrides,
  };
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const clock = new FakeClock(new Date('2026-10-25T12:00:00.000Z'));

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  await app.listen(0, '127.0.0.1');

  return {
    app,
    prisma: app.get(PrismaService),
    config,
    clock,
    pinHasher: app.get(PinHasherService),
  };
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "Shift", "Staff", "Store" CASCADE',
  );
}

export async function createStore(
  prisma: PrismaService,
  overrides: Partial<{
    name: string;
    currency: string;
    timezone: string;
    active: boolean;
  }> = {},
): Promise<{ id: string; name: string }> {
  return prisma.store.create({
    data: {
      name: overrides.name ?? 'Test Store',
      currency: overrides.currency ?? 'USD',
      timezone: overrides.timezone ?? 'UTC',
      active: overrides.active ?? true,
    },
    select: { id: true, name: true },
  });
}

export interface CreateStaffOptions {
  staffCode: string;
  name?: string;
  role?: StaffRole;
  pin?: string;
  active?: boolean;
  mustChangePin?: boolean;
}

export async function createStaff(
  context: Pick<TestContext, 'prisma' | 'pinHasher'>,
  storeId: string,
  options: CreateStaffOptions,
): Promise<StaffModel> {
  const pin = options.pin ?? '246810';
  const pinHash = await context.pinHasher.hash(pin);

  return context.prisma.staff.create({
    data: {
      store_id: storeId,
      staff_code: options.staffCode,
      name: options.name ?? options.staffCode,
      role: options.role ?? 'cashier',
      pin_hash: pinHash,
      active: options.active ?? true,
      must_change_pin: options.mustChangePin ?? false,
    },
  });
}

export function login(
  app: INestApplication,
  staffCode: string,
  pin = '246810',
) {
  return request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ staff_code: staffCode, pin });
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

const SECRET_KEYS = new Set([
  'pin_hash',
  'token_version',
  'failed_pin_attempts',
  'password',
  'secret',
  'pepper',
]);

export function findSecretKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findSecretKeys(item, `${path}[${index}]`),
    );
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    const currentPath = `${path}.${key}`;
    const ownMatch = SECRET_KEYS.has(key) ? [currentPath] : [];
    return [...ownMatch, ...findSecretKeys(nestedValue, currentPath)];
  });
}

export function expectNoSecrets(value: unknown): void {
  expect(findSecretKeys(value)).toEqual([]);
}

export async function loginAs(
  context: TestContext,
  staffCode: string,
  pin = '246810',
): Promise<{ token: string; staffId: string }> {
  const response = await login(context.app, staffCode, pin);
  expect(response.status).toBe(200);

  const token = response.body.access_token as string;
  return { token, staffId: response.body.staff.id as string };
}
