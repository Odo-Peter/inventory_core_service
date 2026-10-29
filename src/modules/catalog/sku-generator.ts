import { randomInt } from 'node:crypto';

/**
 * Server-generated SKUs: `{PREFIX}-{SUFFIX}`, e.g. `BEV-7K3M9Q`.
 *
 * - PREFIX: first 3 letters/digits of the category name (ASCII-folded,
 *   uppercase); `GEN` when the item has no category.
 * - SUFFIX: 6 random characters from the Crockford base32 alphabet, which
 *   drops I, L, O and U so labels are not misread by people.
 * - Uppercase A-Z, 0-9 and "-" only, so the value prints cleanly as a
 *   Code 128 label and is safe in URLs and CSV exports.
 *
 * Uniqueness is per store (`UNIQUE(store_id, sku)`); the caller checks
 * availability and the database constraint is the final guard.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX_LENGTH = 3;
const SUFFIX_LENGTH = 6;
const FALLBACK_PREFIX = 'GEN';

export function skuPrefix(categoryName: string | null | undefined): string {
  const cleaned = (categoryName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (cleaned.length === 0) {
    return FALLBACK_PREFIX;
  }

  return cleaned.slice(0, PREFIX_LENGTH).padEnd(PREFIX_LENGTH, 'X');
}

export function generateSku(categoryName?: string | null): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)];
  }

  return `${skuPrefix(categoryName)}-${suffix}`;
}
