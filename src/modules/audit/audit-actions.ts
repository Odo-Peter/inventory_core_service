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
  categoryCreated: 'category.created',
  categoryUpdated: 'category.updated',
  itemCreated: 'item.created',
  itemUpdated: 'item.updated',
  itemDeactivated: 'item.deactivated',
  itemPriceChanged: 'item.price_changed',
  itemImageUpdated: 'item.image_updated',
  itemImageRemoved: 'item.image_removed',
  stockInitialized: 'stock.initialized',
  stockReceived: 'stock.received',
  stockAdjusted: 'stock.adjusted',
  stockDamaged: 'stock.damaged',
  posAccountCreated: 'pos_account.created',
  posAccountUpdated: 'pos_account.updated',
  posAccountDeactivated: 'pos_account.deactivated',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_FORBIDDEN_DETAIL_KEYS = [
  'pin',
  'pin_hash',
  'token',
  'password',
  'secret',
  'pepper',
  'phone',
  'phone_number',
  'email',
] as const;

export const AUDIT_MASKED_DETAIL_KEYS = ['phone_from', 'phone_to'] as const;
