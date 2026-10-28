import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception.js';
import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor.js';

const CURSOR = {
  created_at: new Date('2026-10-25T12:00:00.000Z'),
  id: '11111111-1111-4111-8111-111111111111',
};

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function expectInvalidCursor(cursor: string): void {
  try {
    decodeAuditCursor(cursor);
    throw new Error('Expected the cursor to be rejected');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(400);
    expect((error as AppException).code).toBe('invalid_cursor');
  }
}

describe('audit cursors', () => {
  it('round-trips a timestamp and id', () => {
    expect(decodeAuditCursor(encodeAuditCursor(CURSOR))).toEqual(CURSOR);
  });

  it('rejects malformed, non-canonical, and oversized cursors', () => {
    expectInvalidCursor('');
    expectInvalidCursor('not-a-cursor');
    expectInvalidCursor(Buffer.from('not json').toString('base64url'));
    expectInvalidCursor(encoded({}));
    expectInvalidCursor(encoded({ ...CURSOR, extra: true }));
    expectInvalidCursor(
      encoded({ created_at: CURSOR.created_at.getTime(), id: CURSOR.id }),
    );
    expectInvalidCursor(encoded({ created_at: '2026-10-25', id: CURSOR.id }));
    expectInvalidCursor(
      encoded({
        created_at: CURSOR.created_at.toISOString(),
        id: 'not-a-uuid',
      }),
    );
    expectInvalidCursor('a'.repeat(513));
  });
});
