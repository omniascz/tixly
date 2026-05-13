/**
 * Shared webhook types — used across all projects.
 */

/** Webhook event to dispatch. */
export interface WebhookEvent {
  /** Event type, e.g. "invoice.created", "order.paid" */
  event: string;
  /** Tenant/org/promoter ID — scopes subscription lookup */
  tenantId: string;
  /** Optional resource ID (the entity that triggered the event) */
  resourceId?: string;
  /** Event payload data */
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/** Structured payload envelope sent to webhook endpoint. */
export interface WebhookPayload {
  id: string;
  event: string;
  tenantId: string;
  resourceId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Webhook subscription record. */
export interface WebhookSubscription {
  id: string;
  tenantId: string;
  url: string;
  /** HMAC secret (64-char hex) — only returned on creation */
  secret: string;
  /** Array of event types this webhook subscribes to */
  events: string[];
  /** Whether the subscription is active */
  active: boolean;
  /** Max delivery attempts before marking as exhausted */
  maxRetries: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
}

/** Delivery attempt status. */
export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying' | 'exhausted';

/** Delivery record. */
export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: string;
  payload: WebhookPayload;
  status: DeliveryStatus;
  attemptCount: number;
  nextRetryAt?: string;
  lastStatusCode?: number;
  lastResponseBody?: string;
  lastError?: string;
  deliveredAt?: string;
  createdAt: string;
}

/** HTTP delivery result. */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  durationMs: number;
}

/** Configuration for the webhook delivery client. */
export interface WebhookClientConfig {
  /** Header prefix for webhook headers. Default: "X-Webhook" */
  headerPrefix?: string;
  /** Default request timeout in ms. Default: 15000 */
  defaultTimeoutMs?: number;
  /** Max response body length to store. Default: 500 */
  maxResponseBodyLength?: number;
  /** User-Agent header. Default: "SharedWebhooks/1.0" */
  userAgent?: string;
}

/** Retry configuration. */
export interface RetryConfig {
  /** Maximum number of retry attempts. Default: 5 */
  maxRetries: number;
  /** Initial delay in seconds before first retry. Default: 30 */
  initialDelaySec: number;
  /** Maximum delay in seconds between retries. Default: 3600 */
  maxDelaySec: number;
  /** Backoff multiplier. Default: 2 (exponential) */
  backoffMultiplier: number;
  /** Number of consecutive failures to auto-disable endpoint. 0 = disabled. */
  autoDisableThreshold: number;
}

/** Default retry configuration — balanced for most use cases. */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelaySec: 30,
  maxDelaySec: 3600,
  backoffMultiplier: 2,
  autoDisableThreshold: 50,
};
