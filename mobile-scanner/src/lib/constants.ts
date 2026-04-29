// ---------------------------------------------------------------------------
// Application-wide constants
// ---------------------------------------------------------------------------

/** Interval between automatic background syncs (milliseconds) */
export const SYNC_INTERVAL_MS = 30_000;

/** TOTP window: number of steps to check either side of current counter */
export const TOTP_WINDOW = 1;

/** Maximum age of cached ticket data in days before clearOldData purges it */
export const MAX_OFFLINE_DAYS = 7;

/** QR payload maximum age in seconds (3 × 30s TOTP windows) */
export const QR_MAX_AGE_SECONDS = 90;

/** Cooldown between scans of the same ticket (milliseconds) */
export const SCAN_COOLDOWN_MS = 1_000;

/** Maximum scan history entries kept in memory */
export const MAX_SCAN_HISTORY = 100;
