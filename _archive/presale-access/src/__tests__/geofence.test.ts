import { describe, it, expect } from 'vitest';
import {
  getCountryFromHeaders,
  isCountryAllowed,
  validateGeofence,
} from '../lib/geofence.js';
import type { GeofenceConfig } from '../types/presale.types.js';
import { GeofenceBlockedError, DEFAULT_LOCAL_EVENT_GEOFENCE } from '../types/presale.types.js';

/**
 * Helper to create a mock Headers object.
 */
function createHeaders(entries: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(entries)) {
    headers.set(key, value);
  }
  return headers;
}

describe('geofence', () => {
  describe('getCountryFromHeaders', () => {
    it('should prefer cf-ipcountry over other headers', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'CZ',
        'x-vercel-ip-country': 'US',
        'x-country-code': 'SK',
      });
      expect(getCountryFromHeaders(headers)).toBe('CZ');
    });

    it('should use x-vercel-ip-country if cf-ipcountry is missing', () => {
      const headers = createHeaders({
        'x-vercel-ip-country': 'US',
        'x-country-code': 'SK',
      });
      expect(getCountryFromHeaders(headers)).toBe('US');
    });

    it('should use x-country-code if higher-priority headers are missing', () => {
      const headers = createHeaders({
        'x-country-code': 'SK',
      });
      expect(getCountryFromHeaders(headers)).toBe('SK');
    });

    it('should return null when no country header is present', () => {
      const headers = createHeaders({});
      expect(getCountryFromHeaders(headers)).toBeNull();
    });

    it('should normalize country codes to uppercase', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'cz',
      });
      expect(getCountryFromHeaders(headers)).toBe('CZ');
    });
  });

  describe('isCountryAllowed', () => {
    const config: GeofenceConfig = {
      allowedCountries: ['CZ', 'SK'],
      bypassForVerifiedLocalUsers: true,
    };

    it('should allow CZ', () => {
      expect(isCountryAllowed('CZ', config)).toBe(true);
    });

    it('should allow SK', () => {
      expect(isCountryAllowed('SK', config)).toBe(true);
    });

    it('should reject US', () => {
      expect(isCountryAllowed('US', config)).toBe(false);
    });

    it('should reject null (unknown) country', () => {
      expect(isCountryAllowed(null, config)).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isCountryAllowed('cz', config)).toBe(true);
      expect(isCountryAllowed('Cz', config)).toBe(true);
    });

    it('should allow all countries when allowedCountries is empty (escape hatch)', () => {
      const emptyConfig: GeofenceConfig = {
        allowedCountries: [],
        bypassForVerifiedLocalUsers: false,
      };
      expect(isCountryAllowed('CZ', emptyConfig)).toBe(true);
      expect(isCountryAllowed('US', emptyConfig)).toBe(true);
      expect(isCountryAllowed(null, emptyConfig)).toBe(true);
    });
  });

  describe('validateGeofence', () => {
    it('should allow CZ via cf-ipcountry', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'CZ',
      });
      expect(() => {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
      }).not.toThrow();
    });

    it('should allow SK via cf-ipcountry', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'SK',
      });
      expect(() => {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
      }).not.toThrow();
    });

    it('should throw GeofenceBlockedError for US', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'US',
      });
      expect(() => {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
      }).toThrow(GeofenceBlockedError);
    });

    it('should throw GeofenceBlockedError for missing header', () => {
      const headers = createHeaders({});
      expect(() => {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
      }).toThrow(GeofenceBlockedError);
    });

    it('should allow CZ via x-vercel-ip-country when cf-ipcountry is missing', () => {
      const headers = createHeaders({
        'x-vercel-ip-country': 'CZ',
      });
      expect(() => {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
      }).not.toThrow();
    });

    it('should throw GeofenceBlockedError with correct message', () => {
      const headers = createHeaders({
        'cf-ipcountry': 'US',
      });
      try {
        validateGeofence(headers, DEFAULT_LOCAL_EVENT_GEOFENCE);
        expect.fail('Should have thrown');
      } catch (err) {
        if (err instanceof GeofenceBlockedError) {
          expect(err.message).toContain('US');
          expect(err.message).toContain('CZ');
          expect(err.message).toContain('SK');
          expect(err.code).toBe('GEOFENCE_BLOCKED');
          expect(err.statusCode).toBe(403);
        } else {
          throw err;
        }
      }
    });
  });
});
