// Nigerian mobile numbers only (prefixes 70x, 71x, 80x, 81x, 90x, 91x).
// If wider formats are needed later, replace this file's internals with libphonenumber-js.
const NATIONAL_NUMBER = /^[789][01]\d{8}$/;
const COUNTRY_CODE = '234';

/** Shape stored in the database. */
export const NIGERIAN_PHONE_E164 = /^\+234[789][01]\d{8}$/;

/**
 * Accepts 08031234567, 8031234567, 2348031234567, +2348031234567,
 * +234 0803 123 4567, and the same with spaces, hyphens, dots or brackets.
 * Returns +234XXXXXXXXXX, or null if the input is not a valid Nigerian mobile number.
 */
export function normalizeNigerianPhone(input: string): string | null {
  let digits = input.trim().replace(/[\s\-.()]/g, '');

  if (digits.startsWith(`+${COUNTRY_CODE}`)) {
    digits = digits.slice(COUNTRY_CODE.length + 1);
  } else if (digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1); // local trunk prefix, also tolerates "+234 0803..."
  }

  return NATIONAL_NUMBER.test(digits) ? `+${COUNTRY_CODE}${digits}` : null;
}

/** "+2348031234567" -> "+234803****567" (for audit logs; never log full numbers). */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 7)}****${phone.slice(-3)}`;
}
