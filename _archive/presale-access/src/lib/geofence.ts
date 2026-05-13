/**
 * Geofencing module for presale access control.
 *
 * Resolves country from request headers with priority order:
 *  1. Cloudflare's `cf-ipcountry` header (most accurate, no lookup needed)
 *  2. Vercel's `x-vercel-ip-country` header
 *  3. `x-country-code` header (set by upstream proxy)
 *  4. Returns null (caller decides whether to allow)
 *
 * Validates country against allow-list for local presales (CZ/SK only).
 */

import type { GeofenceConfig } from '../types/presale.types.js';
import { GeofenceBlockedError } from '../types/presale.types.js';

/**
 * Resolve country code from request headers. Order of precedence:
 *  1. Cloudflare's `cf-ipcountry` header (most accurate, no lookup needed)
 *  2. Vercel's `x-vercel-ip-country` header
 *  3. `x-country-code` header (set by upstream proxy)
 *  4. Returns null (caller decides whether to allow)
 */
export function getCountryFromHeaders(headers: Headers): string | null {
  // 1. Cloudflare header
  const cfCountry = headers.get('cf-ipcountry');
  if (cfCountry) {
    return cfCountry.toUpperCase();
  }

  // 2. Vercel header
  const vercelCountry = headers.get('x-vercel-ip-country');
  if (vercelCountry) {
    return vercelCountry.toUpperCase();
  }

  // 3. Custom header (upstream proxy)
  const customCountry = headers.get('x-country-code');
  if (customCountry) {
    return customCountry.toUpperCase();
  }

  // 4. Unknown
  return null;
}

/**
 * Returns true if the country is in the allow-list.
 * Null country (unknown) is rejected unless allowedCountries is empty.
 * Empty allowedCountries array is an escape hatch: all countries allowed.
 */
export function isCountryAllowed(
  country: string | null,
  config: GeofenceConfig,
): boolean {
  // Escape hatch: empty allow-list means all countries allowed
  if (config.allowedCountries.length === 0) {
    return true;
  }

  // Unknown country is always rejected
  if (country === null) {
    return false;
  }

  // Check if country is in allow-list (case-insensitive)
  return config.allowedCountries.some(
    (allowed) => allowed.toUpperCase() === country.toUpperCase(),
  );
}

/**
 * Validate geofence policy: extract country from headers and verify it matches allow-list.
 * Throws GeofenceBlockedError if country is not allowed.
 */
export function validateGeofence(
  headers: Headers,
  config: GeofenceConfig,
): void {
  const country = getCountryFromHeaders(headers);
  if (!isCountryAllowed(country, config)) {
    throw new GeofenceBlockedError(country, config.allowedCountries);
  }
}
