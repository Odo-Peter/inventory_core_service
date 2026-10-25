export interface Lockout {
  tier: number;
  lockedUntil: Date;
}

export function calculateLockout(
  failedAttempts: number,
  threshold: number,
  lockoutMinutes: number[],
  now: Date,
): Lockout | null {
  if (failedAttempts < threshold || lockoutMinutes.length === 0) {
    return null;
  }

  const tier = Math.min(
    Math.floor(failedAttempts / threshold) - 1,
    lockoutMinutes.length - 1,
  );
  const durationMs = lockoutMinutes[tier] * 60_000;

  return {
    tier,
    lockedUntil: new Date(now.getTime() + durationMs),
  };
}
