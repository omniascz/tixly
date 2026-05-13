/**
 * Onfido environment config loader with dev-mode no-op fallback.
 *
 * Mirrors bankid-config.ts: when any of the required env vars is missing we
 * return `isConfigured: false`. Callers (service + client) then short-circuit
 * to deterministic dev stubs that do not contact the real Onfido API. This
 * lets local dev and CI run without Onfido credentials.
 *
 * Required env vars:
 *   ONFIDO_API_KEY         — Onfido API token
 *   ONFIDO_API_REGION      — 'eu' | 'us' | 'ca' (default 'eu')
 *   ONFIDO_WORKFLOW_ID     — pre-configured workflow in the Onfido dashboard
 *   ONFIDO_WEBHOOK_TOKEN   — HMAC secret used to verify webhook callbacks
 */

export type OnfidoRegion = 'eu' | 'us' | 'ca';

export interface OnfidoConfig {
  apiKey:       string;
  region:       OnfidoRegion;
  apiBaseUrl:   string;
  workflowId:   string;
  webhookToken: string;
  isConfigured: boolean;
}

const REGION_BASE_URLS: Record<OnfidoRegion, string> = {
  eu: 'https://api.eu.onfido.com/v3.6',
  us: 'https://api.us.onfido.com/v3.6',
  ca: 'https://api.ca.onfido.com/v3.6',
};

let warned = false;

function normalizeRegion(raw: string | undefined): OnfidoRegion {
  const v = (raw ?? 'eu').toLowerCase();
  if (v === 'us' || v === 'ca' || v === 'eu') return v;
  return 'eu';
}

export function loadOnfidoConfig(): OnfidoConfig {
  const apiKey       = process.env.ONFIDO_API_KEY       ?? '';
  const region       = normalizeRegion(process.env.ONFIDO_API_REGION);
  const workflowId   = process.env.ONFIDO_WORKFLOW_ID   ?? '';
  const webhookToken = process.env.ONFIDO_WEBHOOK_TOKEN ?? '';
  const apiBaseUrl   = REGION_BASE_URLS[region];

  const isConfigured =
    apiKey.length       > 0 &&
    workflowId.length   > 0 &&
    webhookToken.length > 0;

  if (!isConfigured && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[onfido-config] Onfido is not fully configured — running in dev-mode stub. ' +
      'Set ONFIDO_API_KEY, ONFIDO_WORKFLOW_ID and ONFIDO_WEBHOOK_TOKEN to enable real API calls.',
    );
  }

  return { apiKey, region, apiBaseUrl, workflowId, webhookToken, isConfigured };
}

/** Reset the one-time warning flag — exported for tests only. */
export function __resetOnfidoConfigWarning(): void {
  warned = false;
}
