import 'dotenv/config';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PIN_HASH_OPTIONS } from '../src/modules/auth/pin-hashing.constants.js';
import { applyPinPepper } from '../src/modules/auth/pin-pepper.js';
import { isPinFormatValid, isWeakPin } from '../src/modules/auth/pin-policy.js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
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

async function main(): Promise<void> {
  const storeName = requireEnv('SEED_STORE_NAME');
  const currency = requireEnv('SEED_STORE_CURRENCY');
  const timeZone = requireEnv('SEED_STORE_TIMEZONE');
  const adminCode = requireEnv('SEED_ADMIN_CODE');
  const adminName = requireEnv('SEED_ADMIN_NAME');
  const adminPin = requireEnv('SEED_ADMIN_PIN');
  const pinPepper = requireEnv('PIN_PEPPER');

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error('SEED_STORE_CURRENCY must be an ISO 4217 code');
  }
  assertTimezone(timeZone);

  if (!/^\d{6}$/.test(adminPin)) {
    throw new Error('SEED_ADMIN_PIN must be exactly 6 digits');
  }
  if (!isPinFormatValid(adminPin) || isWeakPin(adminPin)) {
    throw new Error('SEED_ADMIN_PIN is too weak');
  }

  const connectionString = requireEnv('DATABASE_URL');
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
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

      await prisma.staff.upsert({
        where: staffWhere,
        update: {},
        create: {
          store_id: store.id,
          staff_code: adminCode,
          name: adminName,
          pin_hash: pinHash,
          role: 'admin',
          active: true,
        },
      });
    } else {
      const staffUpdate: {
        name?: string;
        role?: 'cashier' | 'manager' | 'admin';
        active?: boolean;
      } = {};

      if (existingAdmin.name !== adminName) {
        staffUpdate.name = adminName;
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

    console.log(`Seed complete for store "${storeName}".`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed', error);
  process.exitCode = 1;
});
