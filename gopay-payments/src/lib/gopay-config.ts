// =============================================================================
// GoPay — konfigurace z ENV proměnných
//
// Pokud chybí jakákoli povinná ENV proměnná → isConfigured=false
// a console.warn se vytiskne jen jednou per process (dev-mode fallback).
// =============================================================================

export interface GopayConfig {
  goid: number;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  notificationUrl: string;
  returnUrl: string;
  isConfigured: boolean;
}

let warningLogged = false;

export function loadGopayConfig(): GopayConfig {
  const goidRaw        = process.env['GOPAY_GOID'];
  const clientId       = process.env['GOPAY_CLIENT_ID'];
  const clientSecret   = process.env['GOPAY_CLIENT_SECRET'];
  const apiBaseUrl     = process.env['GOPAY_API_BASE_URL'] ?? 'https://gate.gopay.cz/api';
  const notificationUrl = process.env['GOPAY_NOTIFICATION_URL'] ?? '';
  const returnUrl      = process.env['GOPAY_RETURN_URL'] ?? '';

  const goid = goidRaw ? Number.parseInt(goidRaw, 10) : NaN;

  const isConfigured =
    !!goidRaw &&
    !Number.isNaN(goid) &&
    !!clientId &&
    !!clientSecret &&
    !!notificationUrl &&
    !!returnUrl;

  if (!isConfigured && !warningLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      '[gopay-payments] GoPay není nakonfigurováno — běží v DEV stub režimu. ' +
        'Nastavte GOPAY_GOID, GOPAY_CLIENT_ID, GOPAY_CLIENT_SECRET, GOPAY_NOTIFICATION_URL, GOPAY_RETURN_URL.',
    );
    warningLogged = true;
  }

  return {
    goid: Number.isNaN(goid) ? 0 : goid,
    clientId: clientId ?? '',
    clientSecret: clientSecret ?? '',
    apiBaseUrl,
    notificationUrl,
    returnUrl,
    isConfigured,
  };
}

// Exportováno pro testy — umožní resetovat warning-once flag mezi testy.
export function __resetGopayConfigWarning(): void {
  warningLogged = false;
}
