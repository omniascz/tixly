import { createHash } from 'node:crypto';

const PII_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b|\b\+?[0-9]{7,15}\b/g;

/**
 * Hash a string using SHA-256 and return a lowercase hex string.
 */
function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Normalize and hash an email address.
 * Process: lowercase → trim → SHA-256 hex
 */
export function hashEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  return sha256hex(normalized);
}

/**
 * Normalize and hash a phone number.
 * Strips spaces, dashes, parentheses, dots and converts to E.164-like form
 * (leading + preserved, only digits after that).
 * Process: normalize → SHA-256 hex
 */
export function hashPhone(phone: string): string {
  const stripped = phone.replace(/[\s\-().]/g, '');
  // Ensure leading + is preserved, all other non-digits removed
  const hasPlus = stripped.startsWith('+');
  const digits = stripped.replace(/\D/g, '');
  const e164 = hasPlus ? `+${digits}` : digits;
  return sha256hex(e164);
}

/**
 * Normalize and hash a name (first or last).
 * Process: lowercase → trim → SHA-256 hex
 */
export function hashName(name: string): string {
  const normalized = name.toLowerCase().trim();
  return sha256hex(normalized);
}

/**
 * Hash an IP address (IPv4 or IPv6).
 * Process: SHA-256 hex (no normalization needed, hash as-is)
 */
export function hashIp(ip: string): string {
  return sha256hex(ip.trim());
}

/**
 * Sanitize a User-Agent string:
 * - Truncate to 512 characters
 * - Strip patterns that resemble PII (email addresses, phone numbers)
 * Returns empty string for falsy input without throwing.
 */
export function sanitizeUserAgent(ua: string): string {
  if (!ua) return '';
  const truncated = ua.slice(0, 512);
  return truncated.replace(PII_PATTERN, '[redacted]');
}
