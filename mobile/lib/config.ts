import Constants from 'expo-constants';

/**
 * Základní URL API. Z app.json → expo.extra.apiBaseUrl (prod: https://app.tixly.cz).
 * Pro lokální vývoj přepiš přes EXPO_PUBLIC_API_BASE_URL (např. http://<LAN-IP>:3000).
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://app.tixly.cz';

/** Stripe publishable key (pk_live_xxx / pk_test_xxx).
 *  Nastav EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY v .env / eas.json.
 *  Pokud prázdný, checkout přepne na WebView fallback. */
export const STRIPE_PUBLISHABLE_KEY: string =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
