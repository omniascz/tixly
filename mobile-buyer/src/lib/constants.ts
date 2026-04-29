export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.tixly.cz';

export const REQUEST_TIMEOUT_MS = 15_000;
export const RETRY_MAX_ATTEMPTS = 2;
export const RETRY_DELAY_MS = 1_000;

export const QR_REFRESH_LEAD_TIME_MS = 3_000; // refresh 3s před expirací
export const QR_POLL_INTERVAL_MS = 25_000;    // fallback interval

export const SYNC_INTERVAL_MS = 5 * 60 * 1_000; // 5 minut

export const SECURE_STORE_KEYS = {
  AUTH_TOKENS: 'tixly_auth_tokens',
  TICKETS_CACHE: 'tixly_tickets_cache',
} as const;
