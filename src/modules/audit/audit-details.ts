import type { Prisma } from '../../generated/prisma/client.js';
import {
  AUDIT_FORBIDDEN_DETAIL_KEYS,
  AUDIT_MASKED_DETAIL_KEYS,
} from './audit-actions.js';

const MASKED_PHONE_E164 = /^\+234[789][01]\d\*{4}\d{3}$/;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMaskedDetailKey(key: string): boolean {
  return AUDIT_MASKED_DETAIL_KEYS.some((candidate) => key === candidate);
}

function isMaskedPhoneValue(key: string, value: unknown): boolean {
  return (
    key === 'phone' &&
    typeof value === 'string' &&
    MASKED_PHONE_E164.test(value)
  );
}

function isForbiddenDetailKey(key: string, value: unknown): boolean {
  return (
    !isMaskedDetailKey(key) &&
    !isMaskedPhoneValue(key, value) &&
    AUDIT_FORBIDDEN_DETAIL_KEYS.some((candidate) => key.includes(candidate))
  );
}

export function assertDetailsAreSafe(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDetailsAreSafe(item);
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (isForbiddenDetailKey(normalizedKey, nestedValue)) {
      throw new Error(`Audit details contain a forbidden key: ${key}`);
    }

    assertDetailsAreSafe(nestedValue);
  }
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const redacted: JsonObject = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (nestedValue === undefined) {
      continue;
    }

    if (isMaskedDetailKey(normalizedKey)) {
      if (
        typeof nestedValue === 'string' &&
        MASKED_PHONE_E164.test(nestedValue)
      ) {
        redacted[key] = nestedValue;
      }
      continue;
    }

    if (isForbiddenDetailKey(normalizedKey, nestedValue)) {
      continue;
    }

    redacted[key] = redactValue(nestedValue);
  }

  return redacted;
}

export function redactAuditDetails(
  value: unknown,
): Prisma.InputJsonObject | null {
  if (!isPlainObject(value)) {
    return null;
  }

  return redactValue(value) as Prisma.InputJsonObject;
}
