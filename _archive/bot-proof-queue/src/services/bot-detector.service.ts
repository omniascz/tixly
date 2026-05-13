import type { BotSignals } from '../lib/types.js';

const HEADLESS_PATTERNS = ['HeadlessChrome', 'PhantomJS', 'Selenium', 'WebDriver'];
const RATE_LIMIT_THRESHOLD = 20;
const DUPLICATE_FINGERPRINT_THRESHOLD = 3;

/**
 * Datacenter IP detection — simplified check.
 * Real implementation would use IP geolocation databases.
 * Considers 10.x.x.x and 172.x.x.x as datacenter/internal ranges.
 */
function isDatacenterIp(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) return true;
  return false;
}

export function detectBotSignals(input: {
  userAgent?: string;
  ipAddress: string;
  fingerprintHash?: string;
  requestsFromIpLast5min: number;
  sameFingerPrintIpCount: number;
}): BotSignals {
  const ua = input.userAgent ?? '';

  const headlessBrowser = HEADLESS_PATTERNS.some((p) => ua.includes(p));

  const suspiciousUserAgent = ua.length < 10;

  const rateLimit = input.requestsFromIpLast5min > RATE_LIMIT_THRESHOLD;

  const datacenterIp = isDatacenterIp(input.ipAddress);

  const duplicateFingerprint = input.sameFingerPrintIpCount > DUPLICATE_FINGERPRINT_THRESHOLD;

  return {
    headlessBrowser,
    suspiciousUserAgent,
    rateLimit,
    datacenterIp,
    duplicateFingerprint,
  };
}
