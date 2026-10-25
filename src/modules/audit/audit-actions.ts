export const AUDIT_ACTIONS = {
  loginSucceeded: 'auth.login_succeeded',
  loginFailed: 'auth.login_failed',
  accountLocked: 'auth.account_locked',
  unlocked: 'auth.unlocked',
  logout: 'auth.logout',
  pinChanged: 'auth.pin_changed',
  pinReset: 'auth.pin_reset',
  tokensRevoked: 'auth.tokens_revoked',
  staffCreated: 'staff.created',
  staffUpdated: 'staff.updated',
  staffRoleChanged: 'staff.role_changed',
  staffDeactivated: 'staff.deactivated',
  staffReactivated: 'staff.reactivated',
  shiftClockIn: 'shift.clock_in',
  shiftClockOut: 'shift.clock_out',
  shiftForceClosed: 'shift.force_closed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_FORBIDDEN_DETAIL_KEYS = [
  'pin',
  'pin_hash',
  'token',
  'password',
  'secret',
  'pepper',
] as const;
