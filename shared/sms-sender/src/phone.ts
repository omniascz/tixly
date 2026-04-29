/**
 * E.164 phone number validation and normalization.
 */

const E164_REGEX = /^\+?[1-9]\d{7,14}$/;

/**
 * Validate and normalize a phone number to E.164 format (with leading +).
 * Throws if the number is invalid.
 */
export function validatePhone(phone: string): string {
  if (typeof phone !== 'string') {
    throw new Error('Invalid phone number: not a string');
  }
  const stripped = phone.replace(/\s+/g, '');
  if (!E164_REGEX.test(stripped)) {
    throw new Error(`Invalid phone number: ${stripped} is not E.164 format`);
  }
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

/**
 * Strip leading + for APIs that expect digits only (e.g. BulkGate).
 */
export function stripPlus(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone;
}

/**
 * Normalize phone to digits only (no +, no spaces, no dashes).
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/\D/g, '');
}
