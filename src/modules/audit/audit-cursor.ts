import { isUUID } from 'class-validator';

import { AppException } from '../../common/errors/app.exception.js';

export interface AuditCursor {
  created_at: Date;
  id: string;
}

function invalidCursor(): AppException {
  return new AppException(400, 'invalid_cursor', 'Invalid cursor');
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.created_at.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeAuditCursor(cursor: string): AuditCursor {
  try {
    if (cursor.length === 0 || cursor.length > 512) {
      throw invalidCursor();
    }

    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(raw, 'utf8').toString('base64url') !== cursor) {
      throw invalidCursor();
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw invalidCursor();
    }

    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 2 ||
      !keys.includes('created_at') ||
      !keys.includes('id') ||
      typeof record.created_at !== 'string' ||
      typeof record.id !== 'string' ||
      !isUUID(record.id)
    ) {
      throw invalidCursor();
    }

    const createdAt = new Date(record.created_at);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== record.created_at
    ) {
      throw invalidCursor();
    }

    return { created_at: createdAt, id: record.id };
  } catch (error: unknown) {
    if (error instanceof AppException) {
      throw error;
    }
    throw invalidCursor();
  }
}
