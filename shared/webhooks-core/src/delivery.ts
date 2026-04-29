/**
 * HTTP webhook delivery client — sends signed payloads to webhook endpoints.
 *
 * Framework-agnostic: uses Node.js fetch() API.
 * Configurable header prefix and timeouts.
 */
import { signPayload } from './signing.js';
import type {
  WebhookPayload,
  WebhookSubscription,
  DeliveryResult,
  WebhookClientConfig,
} from './types.js';

const DEFAULT_CONFIG: Required<WebhookClientConfig> = {
  headerPrefix: 'X-Webhook',
  defaultTimeoutMs: 15000,
  maxResponseBodyLength: 500,
  userAgent: 'SharedWebhooks/1.0',
};

/**
 * Build the webhook payload envelope from an event.
 */
export function buildPayload(
  id: string,
  event: string,
  tenantId: string,
  data: Record<string, unknown>,
  resourceId?: string,
  timestamp?: string,
): WebhookPayload {
  return {
    id,
    event,
    tenantId,
    resourceId,
    timestamp: timestamp ?? new Date().toISOString(),
    data,
  };
}

/**
 * Deliver a webhook payload to an endpoint via HTTP POST.
 *
 * Sends the payload as JSON with HMAC-SHA256 signature in headers.
 * Returns a DeliveryResult with success/failure info.
 *
 * Headers sent:
 *   Content-Type: application/json
 *   {prefix}-Event: <eventType>
 *   {prefix}-Delivery: <deliveryId>
 *   {prefix}-Signature: sha256=<hex>
 *   {prefix}-Timestamp: <ISO8601>
 *   User-Agent: <configured>
 */
export async function deliverWebhook(
  subscription: Pick<WebhookSubscription, 'url' | 'secret' | 'timeoutMs'>,
  deliveryId: string,
  payload: WebhookPayload,
  config?: WebhookClientConfig,
): Promise<DeliveryResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const prefix = cfg.headerPrefix;
  const body = JSON.stringify(payload);
  const signature = signPayload(subscription.secret, body);
  const timestamp = new Date().toISOString();
  const timeoutMs = subscription.timeoutMs || cfg.defaultTimeoutMs;

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [`${prefix}-Event`]: payload.event,
        [`${prefix}-Delivery`]: deliveryId,
        [`${prefix}-Signature`]: signature,
        [`${prefix}-Timestamp`]: timestamp,
        'User-Agent': cfg.userAgent,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const durationMs = Date.now() - startTime;
    let responseBody: string | undefined;
    try {
      const text = await response.text();
      responseBody = text.slice(0, cfg.maxResponseBodyLength);
    } catch {
      // Response body read failure is non-fatal
    }

    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      statusCode: response.status,
      responseBody,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      error: errorMessage,
      durationMs,
    };
  }
}

/**
 * Check if a subscription is interested in a given event type.
 * Supports wildcard '*' to match all events.
 */
export function matchesEvent(
  subscriptionEvents: string[],
  eventType: string,
): boolean {
  if (subscriptionEvents.includes('*')) return true;
  return subscriptionEvents.includes(eventType);
}
