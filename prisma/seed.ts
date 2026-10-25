import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PIN_HASH_OPTIONS } from '../src/modules/auth/pin-hashing.constants.js';
import { applyPinPepper } from '../src/modules/auth/pin-pepper.js';
import { isPinFormatValid, isWeakPin } from '../src/modules/auth/pin-policy.js';
import { normalizeNigerianPhone } from '../src/modules/users/phone.js';

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function assertTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error(
      `SEED_STORE_TIMEZONE is not a valid IANA timezone: ${timeZone}`,
    );
  }
}

export async function runSeed(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const storeName = requireEnv(env, 'SEED_STORE_NAME');
  const currency = requireEnv(env, 'SEED_STORE_CURRENCY');
  const timeZone = requireEnv(env, 'SEED_STORE_TIMEZONE');
  const adminCode = requireEnv(env, 'SEED_ADMIN_CODE');
  const adminFirstName = requireEnv(env, 'SEED_ADMIN_FIRST_NAME');
  const adminLastName = requireEnv(env, 'SEED_ADMIN_LAST_NAME');
  const adminPhone = normalizeNigerianPhone(
    requireEnv(env, 'SEED_ADMIN_PHONE'),
  );
  const adminPin = requireEnv(env, 'SEED_ADMIN_PIN');
  const pinPepper = requireEnv(env, 'PIN_PEPPER');

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('SEED_STORE_CURRENCY must be an ISO 4217 code');
  }
  assertTimezone(timeZone);

  if (!adminPhone) {
    throw new Error(
      'SEED_ADMIN_PHONE must be a valid Nigerian mobile number, e.g. 08031234567',
    );
  }

  if (!/^\d{6}$/.test(adminPin)) {
    throw new Error('SEED_ADMIN_PIN must be exactly 6 digits');
  }
  if (!isPinFormatValid(adminPin) || isWeakPin(adminPin)) {
    throw new Error('SEED_ADMIN_PIN is too weak');
  }

  let store = await prisma.store.findFirst({
    orderBy: { created_at: 'asc' },
  });

  if (!store) {
    store = await prisma.store.create({
      data: { name: storeName, currency, timezone: timeZone },
    });
  } else {
    const storeUpdate: {
      name?: string;
      currency?: string;
      timezone?: string;
      active?: boolean;
    } = {};

    if (store.name !== storeName) {
      storeUpdate.name = storeName;
    }
    if (store.currency !== currency) {
      storeUpdate.currency = currency;
    }
    if (store.timezone !== timeZone) {
      storeUpdate.timezone = timeZone;
    }
    if (!store.active) {
      storeUpdate.active = true;
    }

    if (Object.keys(storeUpdate).length > 0) {
      store = await prisma.store.update({
        where: { id: store.id },
        data: storeUpdate,
      });
    }
  }

  const staffWhere = {
    store_id_staff_code: {
      store_id: store.id,
      staff_code: adminCode,
    },
  };
  const existingAdmin = await prisma.staff.findUnique({
    where: staffWhere,
  });

  if (!existingAdmin) {
    const pinHash = await hash(
      applyPinPepper(adminPin, pinPepper),
      PIN_HASH_OPTIONS,
    );

    await prisma.staff.create({
      data: {
        store_id: store.id,
        staff_code: adminCode,
        first_name: adminFirstName,
        last_name: adminLastName,
        phone: adminPhone,
        pin_hash: pinHash,
        role: 'admin',
        active: true,
      },
    });
    return;
  }

  const staffUpdate: Prisma.StaffUpdateInput = {};

  if (existingAdmin.first_name !== adminFirstName) {
    staffUpdate.first_name = adminFirstName;
  }
  if (existingAdmin.last_name !== adminLastName) {
    staffUpdate.last_name = adminLastName;
  }
  if (existingAdmin.phone !== adminPhone) {
    staffUpdate.phone = adminPhone;
  }
  if (existingAdmin.role !== 'admin') {
    staffUpdate.role = 'admin';
  }
  if (!existingAdmin.active) {
    staffUpdate.active = true;
  }

  if (Object.keys(staffUpdate).length > 0) {
    await prisma.staff.update({
      where: { id: existingAdmin.id },
      data: staffUpdate,
    });
  }
}

async function main(): Promise<void> {
  const connectionString = requireEnv(process.env, 'DATABASE_URL');
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    await runSeed(prisma, process.env);
    console.log('Seed complete for admin user 🎉🎊');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

const isCliEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry) {
  main().catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  });
}
