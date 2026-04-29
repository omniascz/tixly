import {
  type OrderCompletedKafkaEvent,
  type PageViewedKafkaEvent,
  type OrderCreatedKafkaEvent,
  type UserData,
  type MetaPurchasePayload,
  type MetaViewContentPayload,
  type MetaEventData,
  type MetaUserData,
} from '../types/tracking.types.js';

const ACCESS_TOKEN = process.env['META_ACCESS_TOKEN'] ?? '';
const PIXEL_ID = process.env['META_PIXEL_ID'] ?? '';

function buildMetaUserData(userData: UserData): MetaUserData {
  const result: MetaUserData = {
    client_ip_address: userData.clientIpAddress,
    client_user_agent: userData.clientUserAgent,
  };

  if (userData.hashedEmail) result.em = [userData.hashedEmail];
  if (userData.hashedPhone) result.ph = [userData.hashedPhone];
  if (userData.hashedFirstName) result.fn = [userData.hashedFirstName];
  if (userData.hashedLastName) result.ln = [userData.hashedLastName];
  if (userData.fbcCookie) result.fbc = userData.fbcCookie;
  if (userData.fbpCookie) result.fbp = userData.fbpCookie;

  return result;
}

function toUnixTimestamp(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

export function buildMetaPurchasePayload(
  event: OrderCompletedKafkaEvent,
  userData: UserData,
): MetaPurchasePayload {
  const eventData: MetaEventData = {
    event_name: 'Purchase',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `order-${event.orderId}`,
    action_source: 'website',
    user_data: buildMetaUserData(userData),
    custom_data: {
      currency: event.currency,
      value: event.totalAmount,
      content_ids: [event.eventId],
      content_type: 'product',
      content_name: event.eventName,
      num_items: event.quantity,
    },
  };

  return {
    data: [eventData],
    access_token: ACCESS_TOKEN,
  };
}

export function buildMetaViewContentPayload(
  event: PageViewedKafkaEvent,
  userData: UserData,
): MetaViewContentPayload {
  const eventData: MetaEventData = {
    event_name: 'ViewContent',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `view-${event.sessionId}-${event.eventId}`,
    action_source: 'website',
    user_data: buildMetaUserData(userData),
    custom_data: {
      content_ids: [event.eventId],
      content_type: 'product',
      content_name: event.eventName,
      currency: event.currency,
      value: event.minTicketPrice ?? 0,
    },
  };

  return {
    data: [eventData],
    access_token: ACCESS_TOKEN,
  };
}

export function buildMetaInitiateCheckoutPayload(
  event: OrderCreatedKafkaEvent,
  userData: UserData,
): MetaPurchasePayload {
  const eventData: MetaEventData = {
    event_name: 'InitiateCheckout',
    event_time: toUnixTimestamp(event.occurredAt),
    event_id: `checkout-${event.orderId}`,
    action_source: 'website',
    user_data: buildMetaUserData(userData),
    custom_data: {
      currency: event.currency,
      value: event.totalAmount,
      content_ids: [event.eventId],
      content_type: 'product',
      content_name: event.eventName,
      num_items: event.quantity,
    },
  };

  return {
    data: [eventData],
    access_token: ACCESS_TOKEN,
  };
}

/**
 * Add test_event_code to the payload root when provided (staging only).
 * Returns a new object — does not mutate the input.
 */
export function addTestEventCode(
  payload: object,
  testCode: string | undefined,
): object {
  if (!testCode) return payload;
  return { ...payload, test_event_code: testCode };
}

export function getMetaApiUrl(): string {
  return `https://graph.facebook.com/v18.0/${PIXEL_ID}/events`;
}
