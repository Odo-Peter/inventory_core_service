import { Prisma } from '../../generated/prisma/client.js';

const ROLE_PREFIX: Record<string, string> = {
  cashier: 'CSH',
  manager: 'MGR',
  admin: 'ADM',
};

export async function generateStaffCode(
  tx: Prisma.TransactionClient,
  storeId: string,
  role: string,
): Promise<string> {
  const store = await tx.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { name: true },
  });

  const storePrefix = store.name
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 2)
    .padEnd(2, 'X');

  const prefix = `${storePrefix}${ROLE_PREFIX[role]}`;

  // Highest existing number, not a count, so removed staff never cause reuse
  const existing = await tx.staff.findMany({
    where: { store_id: storeId, staff_code: { startsWith: prefix } },
    select: { staff_code: true },
  });

  const max = existing.reduce((highest, { staff_code }) => {
    const suffix = staff_code.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(highest, Number(suffix)) : highest;
  }, 0);

  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
