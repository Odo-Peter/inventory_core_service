import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { POSAccountType } from '../src/generated/prisma/enums.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import type { Principal } from '../src/modules/auth/principal.js';
import { StockService } from '../src/modules/inventory/stock.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
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

  let admin = existingAdmin;

  if (!admin) {
    const pinHash = await hash(
      applyPinPepper(adminPin, pinPepper),
      PIN_HASH_OPTIONS,
    );

    admin = await prisma.staff.create({
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
  } else {
    const staffUpdate: Prisma.StaffUpdateInput = {};

    if (admin.first_name !== adminFirstName) {
      staffUpdate.first_name = adminFirstName;
    }
    if (admin.last_name !== adminLastName) {
      staffUpdate.last_name = adminLastName;
    }
    if (admin.phone !== adminPhone) {
      staffUpdate.phone = adminPhone;
    }
    if (admin.role !== 'admin') {
      staffUpdate.role = 'admin';
    }
    if (!admin.active) {
      staffUpdate.active = true;
    }

    if (Object.keys(staffUpdate).length > 0) {
      admin = await prisma.staff.update({
        where: { id: admin.id },
        data: staffUpdate,
      });
    }
  }

  await seedCatalog(prisma, {
    staff_id: admin.id,
    store_id: store.id,
    role: 'admin',
  });
  await seedPosAccounts(prisma, store.id, admin.id);
}

const SEED_CATEGORIES = ['Beverages', 'Snacks', 'Household'] as const;

const SEED_ITEMS = [
  {
    sku: 'BEV-WATER-50CL',
    barcode: '100000000001',
    name: 'Bottled Water 50cl',
    category: 'Beverages',
    unit: 'bottle',
    current_price: 200,
    cost_price: 120,
    reorder_threshold: 12,
    opening_quantity: 48,
  },
  {
    sku: 'BEV-COLA-50CL',
    barcode: '100000000002',
    name: 'Cola Drink 50cl',
    category: 'Beverages',
    unit: 'bottle',
    current_price: 350,
    cost_price: 250,
    reorder_threshold: 12,
    opening_quantity: 36,
  },
  {
    sku: 'SNK-CHIPS-50G',
    barcode: '100000000003',
    name: 'Potato Chips 50g',
    category: 'Snacks',
    unit: 'pack',
    current_price: 500,
    cost_price: 350,
    reorder_threshold: 8,
    opening_quantity: 24,
  },
  {
    sku: 'HHD-SOAP-100G',
    barcode: '100000000004',
    name: 'Bar Soap 100g',
    category: 'Household',
    unit: 'piece',
    current_price: 450,
    cost_price: 300,
    reorder_threshold: 6,
    opening_quantity: 20,
  },
] as const;

const SEED_POS_ACCOUNTS: ReadonlyArray<{
  label: string;
  type: POSAccountType;
  details: string;
}> = [
  {
    label: 'Front Counter POS',
    type: 'pos_terminal',
    details: 'Counter terminal 1',
  },
  {
    label: 'Store Bank Account',
    type: 'bank_account',
    details: 'Business bank account ending 4821',
  },
];

async function seedCatalog(
  prisma: PrismaClient,
  principal: Principal,
): Promise<void> {
  const prismaService = prisma as unknown as PrismaService;
  const stock = new StockService(
    prismaService,
    new AuditService(prismaService),
  );
  const categoryIds = new Map<string, string>();

  for (const name of SEED_CATEGORIES) {
    const existing = await prisma.category.findUnique({
      where: { store_id_name: { store_id: principal.store_id, name } },
    });
    const category =
      existing ??
      (await prisma.category.create({
        data: { store_id: principal.store_id, name },
      }));
    categoryIds.set(name, category.id);
  }

  for (const item of SEED_ITEMS) {
    const existing = await prisma.item.findUnique({
      where: {
        store_id_sku: { store_id: principal.store_id, sku: item.sku },
      },
    });
    if (existing) {
      continue;
    }

    const created = await prisma.item.create({
      data: {
        store_id: principal.store_id,
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        category_id: categoryIds.get(item.category) ?? null,
        unit: item.unit,
        current_price: item.current_price,
        cost_price: item.cost_price,
        reorder_threshold: item.reorder_threshold,
      },
    });

    await stock.initialize(principal, created.id, {
      quantity: item.opening_quantity,
      note: 'Seed opening stock',
    });
  }
}

async function seedPosAccounts(
  prisma: PrismaClient,
  storeId: string,
  adminStaffId: string,
): Promise<void> {
  for (const account of SEED_POS_ACCOUNTS) {
    const existing = await prisma.pOSAccount.findFirst({
      where: {
        store_id: storeId,
        label: account.label,
        type: account.type,
      },
    });
    if (existing) {
      continue;
    }

    await prisma.pOSAccount.create({
      data: {
        store_id: storeId,
        label: account.label,
        type: account.type,
        details: account.details,
        created_by_staff_id: adminStaffId,
      },
    });
  }
}

async function main(): Promise<void> {
  const connectionString = requireEnv(process.env, 'DATABASE_URL');
  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    await runSeed(prisma, process.env);
    console.log('Seed complete for admin, catalog and POS accounts 🎉🎊');
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
