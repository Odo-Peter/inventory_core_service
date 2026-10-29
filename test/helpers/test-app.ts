import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { CLOCK, type Clock } from '../../src/common/clock.js';
import { APP_CONFIG, type AppConfig } from '../../src/config/app-config.js';
import { PinHasherService } from '../../src/modules/auth/pin-hasher.service.js';
import { IMAGE_STORAGE, type ImageStorage } from '../../src/modules/catalog/image/image-storage.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  authHeader,
  createStaff,
  login,
  loginAs,
  type CreateStaffOptions,
} from '../factories/staff.factory.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { assertTestDatabase } from '../setup/assert-test-db.js';

export { authHeader, createStaff, login, loginAs, type CreateStaffOptions };
export const bearer = authHeader;

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
    imageStorage: { driver: 'disabled' },
    ...overrides,
  };
}

export interface CreateTestAppOptions {
  imageStorage?: ImageStorage;
}

export async function createTestApp(
  overrides: Partial<AppConfig> = {},
  options: CreateTestAppOptions = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const clock = new FakeClock(new Date('2026-10-25T12:00:00.000Z'));

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock);

  if (options.imageStorage) {
    builder.overrideProvider(IMAGE_STORAGE).useValue(options.imageStorage);
  }

  const moduleRef = await builder.compile();

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

export async function truncateAll(prisma: PrismaClient): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL);

  // Table names come from the catalog, so new models are covered automatically.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
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
