import {
  type OrderCompletedKafkaEvent,
  type PageViewedKafkaEvent,
  type OrderCreatedKafkaEvent,
  type UserData,
  type TikTokEventPayload,
  type TikTokContext,
  type TikTokUser,
} from '../types/tracking.types.js';

const ACCESS_TOKEN = process.env['TIKTOK_ACCESS_TOKEN'] ?? '';
const PIXEL_CODE = process.env['TIKTOK_PIXEL_CODE'] ?? '';

const TIKTOK_API_URL =
  'https://business-api.tiktok.com/open_api/v1.3/event/track/';

function buildTikTokUser(userData: UserData): TikTokUser {
  const user: TikTokUser = {};
  if (userData.hashedEmail) user.email = userData.hashedEmail;
  if (userData.hashedPhone) user.phone_number = userData.hashedPhone;
  return user;
}

function buildTikTokContext(
  pageUrl: string,
  userData: UserData,
): TikTokContext {
  return {
    user: buildTikTokUser(userData),
    page: { url: pageUrl },
    ip: userData.clientIpAddress,
    user_agent: userData.clientUserAgent,
  };
}

function toUnixTimestamp(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

export function buildTikTokPurchasePayload(
  event: OrderCompletedKafkaEvent,
  userData: UserData,
): TikTokEventPayload {
  return {
    pixel_code: PIXEL_CODE,
    event: 'CompletePayment',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `order-${event.orderId}`,
    context: buildTikTokContext(event.eventPageUrl, userData),
    properties: {
      currency: event.currency,
      value: event.totalAmount,
      content_id: event.eventId,
      content_type: 'product',
      content_name: event.eventName,
      quantity: event.quantity,
    },
    access_token: ACCESS_TOKEN,
  };
}

export function buildTikTokViewContentPayload(
  event: PageViewedKafkaEvent,
  userData: UserData,
): TikTokEventPayload {
  return {
    pixel_code: PIXEL_CODE,
    event: 'ViewContent',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `view-${event.sessionId}-${event.eventId}`,
    context: buildTikTokContext(event.pageUrl, userData),
    properties: {
      currency: event.currency,
      value: event.minTicketPrice ?? 0,
      content_id: event.eventId,
      content_type: 'product',
      content_name: event.eventName,
    },
    access_token: ACCESS_TOKEN,
  };
}

export function buildTikTokInitiateCheckoutPayload(
  event: OrderCreatedKafkaEvent,
  userData: UserData,
): TikTokEventPayload {
  return {
    pixel_code: PIXEL_CODE,
    event: 'InitiateCheckout',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `checkout-${event.orderId}`,
    context: buildTikTokContext(event.eventPageUrl, userData),
    properties: {
      currency: event.currency,
      value: event.totalAmount,
      content_id: event.eventId,
      content_type: 'product',
      content_name: event.eventName,
      quantity: event.quantity,
    },
    access_token: ACCESS_TOKEN,
  };
}

export { TIKTOK_API_URL };
