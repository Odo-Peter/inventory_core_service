import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CLOCK } from '../src/common/clock.js';
import { APP_CONFIG } from '../src/config/app-config.js';
import type { StaffRole } from '../src/generated/prisma/enums.js';
import { AppModule } from '../src/app.module.js';
import { IS_PUBLIC_KEY } from '../src/modules/auth/decorators/public.decorator.js';
import { ROLES_KEY } from '../src/modules/auth/decorators/roles.decorator.js';
import {
  bearer,
  createStaff,
  createStore,
  createTestApp,
  FakeClock,
  loginAs,
  testConfig,
  truncateAll,
  type TestContext,
} from './helpers/test-app.js';

const ROLES: StaffRole[] = ['cashier', 'manager', 'admin'];

interface RoleCase {
  name: string;
  method: 'get' | 'post' | 'patch';
  path: () => string;
  body?: (role: StaffRole) => Record<string, unknown>;
  expected: Record<StaffRole, number>;
}

const ROLE_CASES: RoleCase[] = [
  {
    name: 'GET /auth/me',
    method: 'get',
    path: () => '/api/v1/auth/me',
    expected: { cashier: 200, manager: 200, admin: 200 },
  },
  {
    name: 'GET /stores/current',
    method: 'get',
    path: () => '/api/v1/stores/current',
    expected: { cashier: 200, manager: 200, admin: 200 },
  },
  {
    name: 'POST /shifts/clock-in',
    method: 'post',
    path: () => '/api/v1/shifts/clock-in',
    body: () => ({ opening_float: 0 }),
    expected: { cashier: 201, manager: 201, admin: 201 },
  },
  {
    name: 'GET /staff',
    method: 'get',
    path: () => '/api/v1/staff',
    expected: { cashier: 403, manager: 200, admin: 200 },
  },
  {
    name: 'GET /shifts',
    method: 'get',
    path: () => '/api/v1/shifts',
    expected: { cashier: 403, manager: 200, admin: 200 },
  },
  {
    name: 'POST /staff',
    method: 'post',
    path: () => '/api/v1/staff',
    body: (role) => ({
      staff_code: `NEW_${role.toUpperCase()}`,
      first_name: 'New',
      last_name: role,
      phone: '08031234567',
      role: 'cashier',
    }),
    expected: { cashier: 403, manager: 403, admin: 201 },
  },
  {
    name: 'PATCH /stores/current',
    method: 'patch',
    path: () => '/api/v1/stores/current',
    body: () => ({ name: 'Updated Store' }),
    expected: { cashier: 403, manager: 403, admin: 200 },
  },
];

describe('Authorization (e2e)', () => {
  let context: TestContext;
  let storeId: string;
  let tokens: Record<StaffRole, string>;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await truncateAll(context.prisma);
    storeId = (await createStore(context.prisma)).id;

    for (const role of ROLES) {
      await createStaff(context, storeId, {
        staffCode: role.toUpperCase(),
        first_name: `${role} firstname`,
        last_name: `${role} lastname`,
        role,
      });
    }

    tokens = {
      cashier: (await loginAs(context, 'CASHIER')).token,
      manager: (await loginAs(context, 'MANAGER')).token,
      admin: (await loginAs(context, 'ADMIN')).token,
    };
  });

  it('mirrors the ADR role matrix', async () => {
    for (const roleCase of ROLE_CASES) {
      for (const role of ROLES) {
        const server = context.app.getHttpServer();
        const path = roleCase.path();
        const client =
          roleCase.method === 'get'
            ? request(server).get(path)
            : roleCase.method === 'post'
              ? request(server).post(path)
              : request(server).patch(path);

        const response = await client
          .set(bearer(tokens[role]))
          .send(roleCase.body?.(role) ?? {})
          .expect(roleCase.expected[role]);

        expect(response.status, `${roleCase.name} as ${role}`).toBe(
          roleCase.expected[role],
        );
      }
    }
  });

  it('prevents managers from resetting or unlocking privileged staff', async () => {
    {
      const manager = await createStaff(context, storeId, {
        staffCode: 'MGR002',
        role: 'manager',
      });
      const admin = await createStaff(context, storeId, {
        staffCode: 'ADMIN002',
        role: 'admin',
      });

      for (const target of [manager, admin]) {
        await request(context.app.getHttpServer())
          .post(`/api/v1/staff/${target.id}/reset-pin`)
          .set(bearer(tokens.manager))
          .send({ acting_pin: '246810' })
          .expect(403);
        await request(context.app.getHttpServer())
          .post(`/api/v1/staff/${target.id}/unlock`)
          .set(bearer(tokens.manager))
          .send({ acting_pin: '246810' })
          .expect(403);
      }
    }
  });

  it('protects the last admin from demotion and self-deactivation', async () => {
    const admin = await context.prisma.staff.findFirstOrThrow({
      where: { store_id: storeId, staff_code: 'ADMIN' },
    });

    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${admin.id}`)
      .set(bearer(tokens.admin))
      .send({ role: 'manager' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('last_admin');
      });

    await request(context.app.getHttpServer())
      .post(`/api/v1/staff/${admin.id}/deactivate`)
      .set(bearer(tokens.admin))
      .expect(403);

    await createStaff(context, storeId, {
      staffCode: 'ADMIN002',
      role: 'admin',
    });

    await request(context.app.getHttpServer())
      .patch(`/api/v1/staff/${admin.id}`)
      .set(bearer(tokens.admin))
      .send({ role: 'manager' })
      .expect(200)
      .expect((response) => {
        expect(response.body.role).toBe('manager');
      });

    await request(context.app.getHttpServer())
      .post('/api/v1/staff')
      .set(bearer(tokens.admin))
      .send({
        staff_code: 'AFTER_DEMOTION',
        first_name: 'Nope',
        last_name: 'Staff',
        phone: '08031234567',
      })
      .expect(403);
  });

  it('requires every controller handler to be public or role-protected', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig())
      .overrideProvider(CLOCK)
      .useValue(new FakeClock(new Date('2026-10-25T12:00:00.000Z')))
      .compile();

    const discovery = moduleRef.get(DiscoveryService);
    const reflector = moduleRef.get(Reflector);
    const scanner = new MetadataScanner();
    const missing: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const metatype = wrapper.metatype;
      if (!metatype) {
        continue;
      }

      const prototype = metatype.prototype as Record<string, unknown>;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        if (typeof handler !== 'function') {
          continue;
        }

        const isRoute =
          Reflect.getMetadata('path', handler) !== undefined ||
          Reflect.getMetadata('method', handler) !== undefined;

        if (!isRoute) {
          continue;
        }

        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          metatype,
        ]);
        const roles = reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
          handler,
          metatype,
        ]);

        if (!isPublic && (!roles || roles.length === 0)) {
          missing.push(`${metatype.name}.${methodName}`);
        }
      }
    }

    await moduleRef.close();
    expect(missing).toEqual([]);
  });
});
