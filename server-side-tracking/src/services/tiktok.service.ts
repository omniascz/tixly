import {
  TrackingPlatform,
  TrackingApiError,
  PayloadBuildError,
  type TrackingResult,
  type ServiceDeps,
  type OrderCompletedKafkaEvent,
  type PageViewedKafkaEvent,
  type OrderCreatedKafkaEvent,
  type UserData,
} from '../types/tracking.types.js';
import {
  buildTikTokPurchasePayload,
  buildTikTokViewContentPayload,
  buildTikTokInitiateCheckoutPayload,
  TIKTOK_API_URL,
} from '../lib/tiktok-payload-builder.js';
import { hashEmail, hashPhone, hashIp, sanitizeUserAgent } from '../lib/pii-hasher.js';
import { withRetry } from '../lib/retry.js';

const RETRY_CONFIG = { maxAttempts: 3, baseDelayMs: 1000 };
const DEDUP_TTL_SECONDS = 86_400; // 24 hours

function buildUserData(event: {
  userEmail?: string;
  userPhone?: string;
  userIp: string;
  userAgent: string;
  fbcCookie?: string;
  fbpCookie?: string;
}): UserData {
  return {
    hashedEmail: event.userEmail ? hashEmail(event.userEmail) : undefined,
    hashedPhone: event.userPhone ? hashPhone(event.userPhone) : undefined,
    clientIpAddress: hashIp(event.userIp),
    clientUserAgent: sanitizeUserAgent(event.userAgent),
    fbcCookie: event.fbcCookie,
    fbpCookie: event.fbpCookie,
  };
}

function redactPiiFromPayload(payload: object): object {
  const safe = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  delete safe['access_token'];
  if (safe['context'] && typeof safe['context'] === 'object') {
    const ctx = { ...(safe['context'] as Record<string, unknown>) };
    delete ctx['user'];
    delete ctx['ip'];
    safe['context'] = ctx;
  }
  return safe;
}

export async function sendEvent(
  eventName: string,
  payload: object,
  eventId: string,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  const dedupKey = `tracking:${TrackingPlatform.TikTok}:${eventId}`;

  const isDuplicate = await deps.redis.exists(dedupKey);
  if (isDuplicate) {
    deps.logger.warn('TikTok: duplicate event skipped', { eventId, eventName });
    return {
      platform: TrackingPlatform.TikTok,
      eventId,
      eventName,
      success: true,
      skippedAsDuplicate: true,
    };
  }

  const safePayload = redactPiiFromPayload(payload);

  let responseStatus = 0;
  let responseBody = '';
  let attempts = 0;

  try {
    const response = await withRetry(async () => {
      attempts++;
      const res = await deps.httpClient.post(TIKTOK_API_URL, payload, {
        'Content-Type': 'application/json',
      });

      if (res.status >= 400) {
        throw new TrackingApiError(
          `TikTok API error ${res.status}`,
          res.status,
          TrackingPlatform.TikTok,
          res.body,
        );
      }
      return res;
    }, RETRY_CONFIG);

    responseStatus = response.status;
    responseBody = response.body;

    await deps.redis.setWithTtl(dedupKey, '1', DEDUP_TTL_SECONDS);

    await deps.db.insertSentEvent({
      platform: TrackingPlatform.TikTok,
      eventName,
      eventId,
      payload: safePayload,
      responseStatus,
      responseBody,
      attempts,
    });

    deps.logger.info('TikTok: event sent successfully', { eventId, eventName, responseStatus });

    return {
      platform: TrackingPlatform.TikTok,
      eventId,
      eventName,
      success: true,
      statusCode: responseStatus,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const statusCode =
      error instanceof TrackingApiError ? error.statusCode : undefined;

    deps.logger.error('TikTok: event failed after retries', {
      eventId,
      eventName,
      error: errorMessage,
      attempts,
    });

    await deps.db.insertFailedEvent({
      platform: TrackingPlatform.TikTok,
      eventName,
      eventId,
      payload: safePayload,
      lastError: errorMessage,
      attempts,
    });

    return {
      platform: TrackingPlatform.TikTok,
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
    payload = buildTikTokPurchasePayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build TikTok purchase payload', err);
  }

  const eventId = `order-${event.orderId}`;
  return sendEvent('CompletePayment', payload, eventId, deps);
}

export async function sendViewContentEvent(
  event: PageViewedKafkaEvent,
  deps: ServiceDeps,
): Promise<TrackingResult> {
  let payload: object;
  try {
    const userData = buildUserData(event);
    payload = buildTikTokViewContentPayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build TikTok ViewContent payload', err);
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
    payload = buildTikTokInitiateCheckoutPayload(event, userData);
  } catch (err) {
    throw new PayloadBuildError('Failed to build TikTok InitiateCheckout payload', err);
  }

  const eventId = `checkout-${event.orderId}`;
  return sendEvent('InitiateCheckout', payload, eventId, deps);
}
