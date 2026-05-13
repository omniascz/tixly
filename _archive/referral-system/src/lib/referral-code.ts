import crypto from 'crypto';

// ============================================================
// Referral Code — pure utility functions
// ============================================================

const BASE62_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const REFERRAL_CODE_REGEX = /^[a-zA-Z0-9]{8}$/;

/**
 * Encode a Buffer to a base62 string.
 * Uses big-endian interpretation of the bytes as a single integer.
 */
export function encodeBase62(buffer: Buffer): string {
  // Treat the buffer as a big unsigned integer
  let num = BigInt('0x' + buffer.toString('hex'));
  const base = BigInt(62);

  const digits: string[] = [];
  while (num > 0n) {
    digits.push(BASE62_ALPHABET[Number(num % base)]);
    num = num / base;
  }

  // Pad with leading '0' chars to reach CODE_LENGTH
  while (digits.length < CODE_LENGTH) {
    digits.push('0');
  }

  // We built digits least-significant first; reverse to get canonical form
  return digits.reverse().join('').slice(-CODE_LENGTH);
}

/**
 * Generate a cryptographically random 8-character base62 referral code.
 */
export function generateReferralCode(): string {
  // 6 bytes = 48 bits → max value 281_474_976_710_655
  // Base62^8 = 218_340_105_584_896 — fits comfortably
  const buf = crypto.randomBytes(6);
  return encodeBase62(buf);
}

/**
 * Validate that a code matches the expected format (8 base62 chars).
 */
export function isValidReferralCode(code: string): boolean {
  return REFERRAL_CODE_REGEX.test(code);
}

/**
 * Build a full referral URL including UTM parameters.
 *
 * @example
 * buildReferralUrl('AbCd1234', 'https://tixly.cz', 'spring-sale')
 * // => 'https://tixly.cz/ref/AbCd1234?utm_source=referral&utm_medium=referral&utm_campaign=spring-sale'
 */
export function buildReferralUrl(
  code: string,
  baseUrl: string,
  campaignId?: string,
): string {
  const url = new URL(`/ref/${code}`, baseUrl);
  url.searchParams.set('utm_source', 'referral');
  url.searchParams.set('utm_medium', 'referral');
  if (campaignId) {
    url.searchParams.set('utm_campaign', campaignId);
  }
  return url.toString();
}
