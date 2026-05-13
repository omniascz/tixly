import type { UtmParams } from '../types/attribution.types';

// ---------------------------------------------------------------------------
// parseUtmParams
// ---------------------------------------------------------------------------

/**
 * Extracts UTM parameters from a URL string or URL object.
 * Only the five standard UTM fields are captured; all other query params
 * are ignored. Missing params are left as `undefined` (not `null`).
 */
export function parseUtmParams(url: string | URL): UtmParams {
  let searchParams: URLSearchParams;

  if (typeof url === 'string') {
    // Support bare paths like '/page?utm_source=foo' by adding a dummy origin.
    try {
      searchParams = new URL(url).searchParams;
    } catch {
      try {
        searchParams = new URL(`https://dummy.local${url.startsWith('/') ? '' : '/'}${url}`).searchParams;
      } catch {
        return {};
      }
    }
  } else {
    searchParams = url.searchParams;
  }

  const result: UtmParams = {};

  const source = searchParams.get('utm_source');
  if (source !== null) result.source = source;

  const medium = searchParams.get('utm_medium');
  if (medium !== null) result.medium = medium;

  const campaign = searchParams.get('utm_campaign');
  if (campaign !== null) result.campaign = campaign;

  const content = searchParams.get('utm_content');
  if (content !== null) result.content = content;

  const term = searchParams.get('utm_term');
  if (term !== null) result.term = term;

  return result;
}

// ---------------------------------------------------------------------------
// deriveChannel
// ---------------------------------------------------------------------------

/**
 * Derives a marketing channel string from UTM parameters and optional referrer.
 *
 * Priority rules (first match wins):
 *   1. utm_source=google AND utm_medium=cpc  → 'google_ads'
 *   2. utm_source=facebook                   → 'facebook'
 *   3. utm_source=email OR utm_medium=email  → 'email'
 *   4. utm_medium=organic                    → 'organic_search'
 *   5. Any utm_source present               → 'utm_<source>' (fallback)
 *   6. Referrer present (no UTM)            → 'referral'
 *   7. Everything else                      → 'direct'
 */
export function deriveChannel(utm: UtmParams, referrer: string | null): string {
  const source = utm.source?.toLowerCase().trim() ?? '';
  const medium = utm.medium?.toLowerCase().trim() ?? '';

  // 1. Google Ads
  if (source === 'google' && medium === 'cpc') {
    return 'google_ads';
  }

  // 2. Facebook
  if (source === 'facebook') {
    return 'facebook';
  }

  // 3. Email
  if (source === 'email' || medium === 'email') {
    return 'email';
  }

  // 4. Organic search
  if (medium === 'organic') {
    return 'organic_search';
  }

  // 5. Any other explicit UTM source → label it
  if (source !== '') {
    return source;
  }

  // 6. Referral (referrer present but no UTM)
  if (referrer !== null && referrer.trim() !== '') {
    return 'referral';
  }

  // 7. Direct visit
  return 'direct';
}
