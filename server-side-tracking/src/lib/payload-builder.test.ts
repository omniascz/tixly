import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMetaPurchasePayload,
  buildMetaViewContentPayload,
  buildMetaInitiateCheckoutPayload,
  addTestEventCode,
} from './meta-payload-builder.js';
import {
  buildTikTokPurchasePayload,
  buildTikTokViewContentPayload,
  buildTikTokInitiateCheckoutPayload,
} from './tiktok-payload-builder.js';
import type {
  OrderCompletedKafkaEvent,
  PageViewedKafkaEvent,
  OrderCreatedKafkaEvent,
  UserData,
} from '../types/tracking.types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HASHED_EMAIL = 'a'.repeat(64);
const HASHED_PHONE = 'b'.repeat(64);

const userData: UserData = {
  hashedEmail: HASHED_EMAIL,
  hashedPhone: HASHED_PHONE,
  clientIpAddress: '1.2.3.4',
  clientUserAgent: 'Mozilla/5.0 Test',
  fbcCookie: 'fb.1.1712246400.AbCd1234',
  fbpCookie: 'fb.1.1712246400.9876543210',
};

const orderCompleted: OrderCompletedKafkaEvent = {
  orderId: 'order-111',
  eventId: 'event-abc',
  eventName: 'Kabát — O2 Arena Praha',
  totalAmount: 1250.0,
  currency: 'CZK',
  quantity: 2,
  eventPageUrl: 'https://tixly.cz/events/kabat-o2-arena',
  userEmail: 'plaintext@example.com', // should NOT appear in output
  userPhone: '+420123456789',        // should NOT appear in output
  userFirstName: 'Jan',
  userLastName: 'Novák',
  userIp: '1.2.3.4',
  userAgent: 'Mozilla/5.0 Test',
  fbcCookie: 'fb.1.1712246400.AbCd1234',
  fbpCookie: 'fb.1.1712246400.9876543210',
  sessionId: 'sess-xyz',
  occurredAt: '2024-04-05T00:00:00.000Z',
};

const pageViewed: PageViewedKafkaEvent = {
  sessionId: 'sess-xyz',
  eventId: 'event-abc',
  eventName: 'Kabát — O2 Arena Praha',
  pageType: 'event_detail',
  pageUrl: 'https://tixly.cz/events/kabat-o2-arena',
  minTicketPrice: 850.0,
  currency: 'CZK',
  userEmail: 'plaintext@example.com',
  userIp: '1.2.3.4',
  userAgent: 'Mozilla/5.0 Test',
  occurredAt: '2024-04-05T00:00:00.000Z',
};

const orderCreated: OrderCreatedKafkaEvent = {
  orderId: 'order-222',
  eventId: 'event-abc',
  eventName: 'Kabát — O2 Arena Praha',
  totalAmount: 1250.0,
  currency: 'CZK',
  quantity: 2,
  eventPageUrl: 'https://tixly.cz/events/kabat-o2-arena',
  userEmail: 'plaintext@example.com',
  userPhone: '+420123456789',
  userFirstName: 'Jan',
  userLastName: 'Novák',
  userIp: '1.2.3.4',
  userAgent: 'Mozilla/5.0 Test',
  fbcCookie: undefined,
  fbpCookie: undefined,
  sessionId: 'sess-xyz',
  occurredAt: '2024-04-05T00:00:00.000Z',
};

// ─── Meta Purchase Payload ────────────────────────────────────────────────────

describe('buildMetaPurchasePayload', () => {
  it('sets event_name to Purchase', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect(payload.data[0].event_name).toBe('Purchase');
  });

  it('uses currency CZK', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect((payload.data[0].custom_data as any).currency).toBe('CZK');
  });

  it('formats event_id as order-{orderId}', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect(payload.data[0].event_id).toBe('order-order-111');
  });

  it('does NOT contain plaintext email in output', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('plaintext@example.com');
  });

  it('does NOT contain plaintext phone in output', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('+420123456789');
  });

  it('does NOT contain plaintext name in output', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Jan');
    expect(serialized).not.toContain('Novák');
  });

  it('includes hashed email in user_data.em', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect(payload.data[0].user_data.em).toEqual([HASHED_EMAIL]);
  });

  it('includes hashed phone in user_data.ph', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect(payload.data[0].user_data.ph).toEqual([HASHED_PHONE]);
  });

  it('sets action_source to website', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect(payload.data[0].action_source).toBe('website');
  });

  it('includes num_items', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect((payload.data[0].custom_data as any).num_items).toBe(2);
  });

  it('includes content_ids with event UUID', () => {
    const payload = buildMetaPurchasePayload(orderCompleted, userData);
    expect((payload.data[0].custom_data as any).content_ids).toContain('event-abc');
  });
});

// ─── Meta ViewContent Payload ─────────────────────────────────────────────────

describe('buildMetaViewContentPayload', () => {
  it('sets event_name to ViewContent', () => {
    const payload = buildMetaViewContentPayload(pageViewed, userData);
    expect(payload.data[0].event_name).toBe('ViewContent');
  });

  it('formats event_id as view-{sessionId}-{eventId}', () => {
    const payload = buildMetaViewContentPayload(pageViewed, userData);
    expect(payload.data[0].event_id).toBe('view-sess-xyz-event-abc');
  });

  it('does NOT contain plaintext email', () => {
    const payload = buildMetaViewContentPayload(pageViewed, userData);
    expect(JSON.stringify(payload)).not.toContain('plaintext@example.com');
  });
});

// ─── addTestEventCode ─────────────────────────────────────────────────────────

describe('addTestEventCode', () => {
  it('adds test_event_code when code is provided', () => {
    const base = { data: [], access_token: 'token' };
    const result = addTestEventCode(base, 'TEST123') as any;
    expect(result.test_event_code).toBe('TEST123');
  });

  it('does not add test_event_code when undefined', () => {
    const base = { data: [], access_token: 'token' };
    const result = addTestEventCode(base, undefined) as any;
    expect(result.test_event_code).toBeUndefined();
  });

  it('does not mutate the original payload', () => {
    const base = { data: [], access_token: 'token' };
    addTestEventCode(base, 'CODE');
    expect((base as any).test_event_code).toBeUndefined();
  });
});

// ─── TikTok Purchase Payload ──────────────────────────────────────────────────

describe('buildTikTokPurchasePayload', () => {
  it('sets event to CompletePayment', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(payload.event).toBe('CompletePayment');
  });

  it('formats event_id as order-{orderId}', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(payload.event_id).toBe('order-order-111');
  });

  it('sets currency CZK', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(payload.properties.currency).toBe('CZK');
  });

  it('does NOT contain plaintext email in output', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(JSON.stringify(payload)).not.toContain('plaintext@example.com');
  });

  it('does NOT contain plaintext phone in output', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(JSON.stringify(payload)).not.toContain('+420123456789');
  });

  it('includes hashed email in context.user.email', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(payload.context.user.email).toBe(HASHED_EMAIL);
  });

  it('maps quantity correctly', () => {
    const payload = buildTikTokPurchasePayload(orderCompleted, userData);
    expect(payload.properties.quantity).toBe(2);
  });
});

// ─── TikTok ViewContent Payload ───────────────────────────────────────────────

describe('buildTikTokViewContentPayload', () => {
  it('sets event to ViewContent', () => {
    const payload = buildTikTokViewContentPayload(pageViewed, userData);
    expect(payload.event).toBe('ViewContent');
  });

  it('formats event_id as view-{sessionId}-{eventId}', () => {
    const payload = buildTikTokViewContentPayload(pageViewed, userData);
    expect(payload.event_id).toBe('view-sess-xyz-event-abc');
  });
});

// ─── TikTok InitiateCheckout Payload ─────────────────────────────────────────

describe('buildTikTokInitiateCheckoutPayload', () => {
  it('sets event to InitiateCheckout', () => {
    const payload = buildTikTokInitiateCheckoutPayload(orderCreated, userData);
    expect(payload.event).toBe('InitiateCheckout');
  });

  it('formats event_id as checkout-{orderId}', () => {
    const payload = buildTikTokInitiateCheckoutPayload(orderCreated, userData);
    expect(payload.event_id).toBe('checkout-order-222');
  });
});

// ─── Meta InitiateCheckout Payload ───────────────────────────────────────────

describe('buildMetaInitiateCheckoutPayload', () => {
  it('sets event_name to InitiateCheckout', () => {
    const payload = buildMetaInitiateCheckoutPayload(orderCreated, userData);
    expect(payload.data[0].event_name).toBe('InitiateCheckout');
  });

  it('formats event_id as checkout-{orderId}', () => {
    const payload = buildMetaInitiateCheckoutPayload(orderCreated, userData);
    expect(payload.data[0].event_id).toBe('checkout-order-222');
  });
});
