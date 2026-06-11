import Constants from 'expo-constants';

/**
 * Základní URL API. Z app.json → expo.extra.apiBaseUrl (prod: https://app.tixly.cz).
 * Lokální vývoj přepiš přes EXPO_PUBLIC_API_BASE_URL (např. http://<LAN-IP>:3000).
 */
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://app.tixly.cz';
