import { describe, expect, it } from 'vitest';

import type { Clock } from '../../common/clock.js';
import { calculateLockout } from './auth.config.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceMs(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

describe('calculateLockout', () => {
  const minutes = [5, 15, 60];

  it('does nothing below the threshold', () => {
    const clock = new FakeClock(new Date('2026-10-25T12:00:00.000Z'));
    expect(calculateLockout(4, 5, minutes, clock.now())).toBeNull();
  });

  it('escalates the lock duration by attempt tier', () => {
    const clock = new FakeClock(new Date('2026-10-25T12:00:00.000Z'));

    expect(calculateLockout(5, 5, minutes, clock.now())).toMatchObject({
      tier: 0,
      lockedUntil: new Date('2026-10-25T12:05:00.000Z'),
    });
    expect(calculateLockout(9, 5, minutes, clock.now())).toMatchObject({
      tier: 0,
      lockedUntil: new Date('2026-10-25T12:05:00.000Z'),
    });
    expect(calculateLockout(10, 5, minutes, clock.now())).toMatchObject({
      tier: 1,
      lockedUntil: new Date('2026-10-25T12:15:00.000Z'),
    });
    expect(calculateLockout(15, 5, minutes, clock.now())).toMatchObject({
      tier: 2,
      lockedUntil: new Date('2026-10-25T13:00:00.000Z'),
    });
    expect(calculateLockout(25, 5, minutes, clock.now())).toMatchObject({
      tier: 2,
      lockedUntil: new Date('2026-10-25T13:00:00.000Z'),
    });

    clock.advanceMs(60_000);
    expect(calculateLockout(5, 5, minutes, clock.now())?.lockedUntil).toEqual(
      new Date('2026-10-25T12:06:00.000Z'),
    );
  });
});
