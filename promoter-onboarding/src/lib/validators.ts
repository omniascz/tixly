/**
 * Validates Czech IČO (company registration number).
 * Must be exactly 8 digits.
 */
export function validateIco(ico: string): boolean {
  return /^\d{8}$/.test(ico);
}

/**
 * Validates Czech IBAN format.
 * Format: "CZ" followed by exactly 22 digits (total 24 characters).
 * Note: This validates format only, not the checksum algorithm.
 */
export function validateCzIban(iban: string): boolean {
  return /^CZ\d{22}$/.test(iban);
}

/**
 * Validates password strength.
 * Requirements: minimum 8 characters, at least one digit.
 */
export function validatePassword(password: string): boolean {
  if (password.length < 8) return false;
  return /\d/.test(password);
}
