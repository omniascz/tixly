// =============================================================================
// BulkGate config — načtení z env proměnných s dev fallbackem
// =============================================================================

export interface BulkgateConfig {
  appId: number;
  appToken: string;
  apiBaseUrl: string;
  senderId: string; // e.g. 'gText' or 'gNumeric' or specific ID
  senderIdValue: string; // e.g. 'PulseUp'
  isConfigured: boolean;
}

const DEFAULT_BASE_URL = 'https://portal.bulkgate.com/api/1.0';
const DEFAULT_SENDER_ID = 'gText';

let warned = false;

export function loadBulkgateConfig(): BulkgateConfig {
  const appIdRaw = process.env.BULKGATE_APP_ID;
  const appToken = process.env.BULKGATE_APP_TOKEN;
  const apiBaseUrl = process.env.BULKGATE_API_BASE_URL ?? DEFAULT_BASE_URL;
  const senderId = process.env.BULKGATE_SENDER_ID ?? DEFAULT_SENDER_ID;
  const senderIdValue = process.env.BULKGATE_SENDER_ID_VALUE ?? 'PulseUp';

  const appId = appIdRaw ? parseInt(appIdRaw, 10) : 0;
  const isConfigured =
    Boolean(appIdRaw) && Boolean(appToken) && !Number.isNaN(appId) && appId > 0;

  if (!isConfigured && !warned) {
    warned = true;
    console.warn(
      '[bulkgate-sms] BULKGATE_APP_ID / BULKGATE_APP_TOKEN nejsou nastaveny. ' +
        'SMS budou v dev režimu (no-op).',
    );
  }

  return {
    appId,
    appToken: appToken ?? '',
    apiBaseUrl,
    senderId,
    senderIdValue,
    isConfigured,
  };
}
