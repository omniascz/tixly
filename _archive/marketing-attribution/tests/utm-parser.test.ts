import { describe, it, expect } from 'vitest';
import { parseUtmParams, deriveChannel } from '../src/lib/utm-parser';
import type { UtmParams } from '../src/types/attribution.types';

// ---------------------------------------------------------------------------
// parseUtmParams
// ---------------------------------------------------------------------------

describe('parseUtmParams', () => {
  it('extracts all five UTM parameters from a full URL', () => {
    const url =
      'https://tixly.cz/event/123?utm_source=google&utm_medium=cpc&utm_campaign=summer&utm_content=banner&utm_term=concert';
    const result = parseUtmParams(url);
    expect(result.source).toBe('google');
    expect(result.medium).toBe('cpc');
    expect(result.campaign).toBe('summer');
    expect(result.content).toBe('banner');
    expect(result.term).toBe('concert');
  });

  it('returns empty object when no UTM params are present', () => {
    const result = parseUtmParams('https://tixly.cz/event/123');
    expect(result).toEqual({});
  });

  it('returns only the params that are present (partial set)', () => {
    const url = 'https://tixly.cz/?utm_source=facebook&utm_medium=social';
    const result = parseUtmParams(url);
    expect(result.source).toBe('facebook');
    expect(result.medium).toBe('social');
    expect(result.campaign).toBeUndefined();
    expect(result.content).toBeUndefined();
    expect(result.term).toBeUndefined();
  });

  it('accepts a URL object (not just a string)', () => {
    const url = new URL('https://tixly.cz/?utm_source=email&utm_medium=email');
    const result = parseUtmParams(url);
    expect(result.source).toBe('email');
    expect(result.medium).toBe('email');
  });

  it('accepts a bare path string', () => {
    const result = parseUtmParams('/promo?utm_source=twitter');
    expect(result.source).toBe('twitter');
  });

  it('ignores non-UTM query parameters', () => {
    const url = 'https://tixly.cz/?foo=bar&utm_source=google&baz=qux';
    const result = parseUtmParams(url);
    expect(Object.keys(result)).toEqual(['source']);
    expect(result.source).toBe('google');
  });

  it('handles URL-encoded UTM values correctly', () => {
    const url = 'https://tixly.cz/?utm_campaign=p%C3%A1tek+v+Praze';
    const result = parseUtmParams(url);
    expect(result.campaign).toBe('pátek v Praze');
  });

  it('returns empty object for a URL with only a fragment', () => {
    const result = parseUtmParams('https://tixly.cz/#section');
    expect(result).toEqual({});
  });

  it('handles an empty query string gracefully', () => {
    const result = parseUtmParams('https://tixly.cz/?');
    expect(result).toEqual({});
  });

  it('does not throw on a completely invalid URL string', () => {
    expect(() => parseUtmParams('not-a-url-at-all!!')).not.toThrow();
  });

  it('preserves original casing of UTM values', () => {
    const url = 'https://tixly.cz/?utm_source=Google&utm_medium=CPC';
    const result = parseUtmParams(url);
    expect(result.source).toBe('Google');
    expect(result.medium).toBe('CPC');
  });

  it('handles duplicate UTM keys by using the first occurrence (URLSearchParams standard)', () => {
    const url = 'https://tixly.cz/?utm_source=first&utm_source=second';
    const result = parseUtmParams(url);
    expect(result.source).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// deriveChannel
// ---------------------------------------------------------------------------

describe('deriveChannel', () => {
  it('returns "google_ads" for utm_source=google + utm_medium=cpc', () => {
    const utm: UtmParams = { source: 'google', medium: 'cpc' };
    expect(deriveChannel(utm, null)).toBe('google_ads');
  });

  it('returns "google_ads" regardless of case (google/CPC)', () => {
    const utm: UtmParams = { source: 'Google', medium: 'CPC' };
    expect(deriveChannel(utm, null)).toBe('google_ads');
  });

  it('returns "facebook" for utm_source=facebook', () => {
    const utm: UtmParams = { source: 'facebook', medium: 'social' };
    expect(deriveChannel(utm, null)).toBe('facebook');
  });

  it('returns "facebook" for utm_source=facebook with no medium', () => {
    const utm: UtmParams = { source: 'facebook' };
    expect(deriveChannel(utm, null)).toBe('facebook');
  });

  it('returns "email" for utm_source=email', () => {
    const utm: UtmParams = { source: 'email' };
    expect(deriveChannel(utm, null)).toBe('email');
  });

  it('returns "email" for utm_medium=email (no source)', () => {
    const utm: UtmParams = { medium: 'email' };
    expect(deriveChannel(utm, null)).toBe('email');
  });

  it('returns "organic_search" for utm_medium=organic', () => {
    const utm: UtmParams = { medium: 'organic' };
    expect(deriveChannel(utm, null)).toBe('organic_search');
  });

  it('returns source as channel for unknown utm_source', () => {
    const utm: UtmParams = { source: 'twitter', medium: 'social' };
    expect(deriveChannel(utm, null)).toBe('twitter');
  });

  it('returns "referral" when no UTM params but referrer is present', () => {
    const utm: UtmParams = {};
    expect(deriveChannel(utm, 'https://blog.example.com')).toBe('referral');
  });

  it('returns "direct" when no UTM params and no referrer', () => {
    expect(deriveChannel({}, null)).toBe('direct');
  });

  it('returns "direct" when referrer is an empty string', () => {
    expect(deriveChannel({}, '')).toBe('direct');
  });

  it('google_ads takes precedence over referral when both present', () => {
    const utm: UtmParams = { source: 'google', medium: 'cpc' };
    expect(deriveChannel(utm, 'https://google.com')).toBe('google_ads');
  });
});
