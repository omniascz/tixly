import {
  TrackingPlatform,
  TrackingApiError,
  DuplicateEventError,
  PayloadBuildError,
  type TrackingResult,
  type ServiceDeps,
  type OrderCompletedKafkaEvent,
  type PageViewedKafkaEvent,
  type OrderCreatedKafkaEvent,
  type UserData,
} from '../types/tracking.types.js';
import {
  buildMetaPurchasePayload,
  buildMetaViewContentPayload,
  buildMetaInitiateCheckoutPayload,
  addTestEventCode,
  getMetaApiUrl,
} from '../lib/meta-payload-builder.js';
import { hashEmail, hashPhone, hashName, hashIp, sanitizeUserAgent } from '../lib/pii-hasher.js';
import { withRetry } from '../lib/retry.js';

const RETRY_CONFIG = { maxAttempts: 3, baseDelayMs: 1000 };
const DEDUP_TTL_SECONDS = 86_400; // 24 hours

function buildUserData(event: {
  userEmail?: string;
  userPhone?: string;
  userFirstName?: string;
  userLastName?: string;
  userIp: string;
  userAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
}): UserData {
  return {
    hashedEmail: event.userEmail ? hashEmail(event.userEmail) : undefined,
    hashedPhone: event.userPhone ? hashPhone(event.userPhone) : undefined,
    hashedFirstName: event.userFirstName ? hashName(event.userFirstName) : undefined,
    hashedLastName: event.userLastName ? hashName(event.userLastName) : undefined,
    clientIpAddress: hashIp(event.userIp),
    clientUserAgent: sanitizeUserAgent(event.userAgent),
    fbcCookie: event.fbcCookie,
    fbpCookie: event.fbpCookie,
  };
}

function redactPiiFromPayload(payload: object): object {
  // Strip access_token and user PII fields before persisting to DB
  const safe = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete safe['access_token'];
  if (Array.isArray(safe['data'])) {
    safe['data'] = (safe['data'] as Array<Record<string, unknown>>).map((item) => {
      const sanitized = { ...item };
      delete sanitized['user_data'];
      return sanitized;
    });
  }
  return safe;
}

export async function sendEvent(
  eventName: string,
  payload: object,
  eventId: string,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  const dedupKey = `tracking:${TrackingPlatform.Meta}:${eventId}`;

  const isDuplicate = await deps.redis.exists(dedupKey);
  if (isDuplicate) {
    deps.logger.warn('Meta: duplicate event skipped', { eventId, eventName });
    return {
      platform: TrackingPlatform.Meta,
      eventId,
      eventName,
      success: true,
      skippedAsDuplicate: true,
    };
  }

  const url = getMetaApiUrl();
  const testCode = process.env['META_TEST_EVENT_CODE'];
  const finalPayload = addTestEventCode(payload, testCode);
  const safePayload = redactPiiFromPayload(finalPayload);

  let responseStatus = 0;
  let responseBody = '';
  let attempts = 0;

  try {
    const response = await withRetry(async () => {
      attempts++;
      const res = await deps.httpClient.post(url, finalPayload, {
        'Content-Type': 'application/json',
      });

      if (res.status >= 400) {
        throw new TrackingApiError(
          `Meta API error ${res.status}`,
          res.status,
          TrackingPlatform.Meta,
          res.body,
        );
      }
      return res;
    }, RETRY_CONFIG);

    responseStatus = response.status;
    responseBody = response.body;

    await deps.redis.setWithTtl(dedupKey, '1', DEDUP_TTL_SECONDS);

    await deps.db.insertSentEvent({
      platform: TrackingPlatform.Meta,
      eventName,
      eventId,
      payload: safePayload,
      responseStatus,
      responseBody,
      attempts,
    });

    deps.logger.info('Meta: event sent successfully', { eventId, eventName, responseStatus });

    return {
      platform: TrackingPlatform.Meta,
      eventId,
      eventName,
      success: true,
      statusCode: responseStatus,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode =
      error instanceof TrackingApiError ? error.statusCode : undefined;

    deps.logger.error('Meta: event failed after retries', {
      eventId,
      eventName,
      error: errorMessage,
      attempts,
    });

    await deps.db.insertFailedEvent({
      platform: TrackingPlatform.Meta,
      eventName,
      eventId,
      payload: safePayload,
      lastError: errorMessage,
      attempts,
    });

    return {
      platform: TrackingPlatform.Meta,
      eventId,
      eventName,
      success: false,
      statusCode,
      error: errorMessage,
    };
  }
}

export async function sendPurchaseEvent(
  event: OrderCompletedKafkaEvent,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  let payload: object;
  try {
    const userData = buildUserData(event);
    payload = buildMetaPurchasePayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build Meta purchase payload', err);
  }

  const eventId = `order-${event.orderId}`;
  return sendEvent('Purchase', payload, eventId, deps);
}

export async function sendViewContentEvent(
  event: PageViewedKafkaEvent,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  let payload: object;
  try {
    const userData = buildUserData(event);
    payload = buildMetaViewContentPayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build Meta ViewContent payload', err);
  }

  const eventId = `view-${event.sessionId}-${event.eventId}`;
  return sendEvent('ViewContent', payload, eventId, deps);
}

export async function sendInitiateCheckoutEvent(
  event: OrderCreatedKafkaEvent,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  let payload: object;
  try {
    const userData = buildUserData(event);
    payload = buildMetaInitiateCheckoutPayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build Meta InitiateCheckout payload', err);
  }

  const eventId = `checkout-${event.orderId}`;
  return sendEvent('InitiateCheckout', payload, eventId, deps);
}
