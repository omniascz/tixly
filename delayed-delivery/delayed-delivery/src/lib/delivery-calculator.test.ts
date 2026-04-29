import { describe, it, expect } from 'vitest';
import {
  calculateDeliverAt,
  isDeliveryDue,
  validateDeliveryConfig,
  shouldRetry,
  buildKafkaPayload,
} from './delivery-calculator';
import type { DeliverySchedule, DeliveryConfig } from '../types/delayed-delivery.types';
import { DeliveryInvalidConfigError } from '../types/delayed-delivery.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSchedule(overrides: Partial<DeliverySchedule> = {}): DeliverySchedule {
  return {
    id: 'sched-1',
    ticket_id: 'ticket-1',
    order_id: 'order-1',
    event_id: 'event-1',
    event_starts_at: new Date('2026-06-01T18:00:00Z'),
    delivery_type: 'timed',
    deliver_at: new Date('2026-05-30T18:00:00Z'), // 48h before
    hours_before: 48,
    status: 'pending',
    channels: ['email', 'push'],
    delivered_at: null,
    failed_at: null,
    retry_count: 0,
    created_at: new Date('2026-04-01T10:00:00Z'),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<DeliveryConfig> = {}): DeliveryConfig {
  return {
    ticket_type_id: 'tt-1',
    delivery_type: 'timed',
    hours_before: 48,
    channels: ['email', 'push'],
    active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// calculateDeliverAt
// ---------------------------------------------------------------------------

describe('calculateDeliverAt', () => {
  const eventStart = new Date('2026-06-01T18:00:00Z');

  it('subtracts 24 hours from event start', () => {
    const result = calculateDeliverAt(eventStart, 24);
    expect(result.toISOString()).toBe('2026-05-31T18:00:00.000Z');
  });

  it('subtracts 48 hours from event start', () => {
    const result = calculateDeliverAt(eventStart, 48);
    expect(result.toISOString()).toBe('2026-05-30T18:00:00.000Z');
  });

  it('returns event start when hours_before = 0 (immediate edge case)', () => {
    const result = calculateDeliverAt(eventStart, 0);
    expect(result.getTime()).toBe(eventStart.getTime());
  });

  it('handles fractional hours correctly', () => {
    // 1.5 hours = 5 400 000 ms
    const result = calculateDeliverAt(eventStart, 1.5);
    expect(result.getTime()).toBe(eventStart.getTime() - 5_400_000);
  });
});

// ---------------------------------------------------------------------------
// isDeliveryDue
// ---------------------------------------------------------------------------

describe('isDeliveryDue', () => {
  const deliver_at = new Date('2026-05-30T18:00:00Z');

  it('returns true when deliver_at has passed and status is pending', () => {
    const schedule = makeSchedule({ deliver_at, status: 'pending' });
    const now = new Date('2026-05-30T19:00:00Z'); // 1h after
    expect(isDeliveryDue(schedule, now)).toBe(true);
  });

  it('returns true exactly at deliver_at moment', () => {
    const schedule = makeSchedule({ deliver_at, status: 'pending' });
    expect(isDeliveryDue(schedule, deliver_at)).toBe(true);
  });

  it('returns false when deliver_at is in the future', () => {
    const schedule = makeSchedule({ deliver_at, status: 'pending' });
    const now = new Date('2026-05-30T17:00:00Z'); // 1h before
    expect(isDeliveryDue(schedule, now)).toBe(false);
  });

  it('returns false when status is already delivered', () => {
    const schedule = makeSchedule({
      deliver_at,
      status: 'delivered',
      delivered_at: new Date(),
    });
    const now = new Date('2026-05-30T19:00:00Z');
    expect(isDeliveryDue(schedule, now)).toBe(false);
  });

  it('returns false when status is failed', () => {
    const schedule = makeSchedule({ deliver_at, status: 'failed' });
    const now = new Date('2026-05-30T19:00:00Z');
    expect(isDeliveryDue(schedule, now)).toBe(false);
  });

  it('returns false for manual delivery type regardless of time', () => {
    const schedule = makeSchedule({
      delivery_type: 'manual',
      deliver_at: null,
      status: 'pending',
    });
    const now = new Date('2026-05-30T19:00:00Z');
    expect(isDeliveryDue(schedule, now)).toBe(false);
  });

  it('returns false for immediate delivery type', () => {
    const schedule = makeSchedule({
      delivery_type: 'immediate',
      deliver_at: new Date('2026-04-01T10:00:00Z'),
      status: 'pending',
    });
    const now = new Date('2026-05-30T19:00:00Z');
    expect(isDeliveryDue(schedule, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDeliveryConfig
// ---------------------------------------------------------------------------

describe('validateDeliveryConfig', () => {
  it('throws DeliveryInvalidConfigError when timed config has no hours_before', () => {
    const config = makeConfig({ delivery_type: 'timed', hours_before: null });
    expect(() => validateDeliveryConfig(config)).toThrowError(DeliveryInvalidConfigError);
  });

  it('throws DeliveryInvalidConfigError when hours_before = 0', () => {
    const config = makeConfig({ delivery_type: 'timed', hours_before: 0 });
    expect(() => validateDeliveryConfig(config)).toThrowError(DeliveryInvalidConfigError);
  });

  it('throws DeliveryInvalidConfigError when hours_before is negative', () => {
    const config = makeConfig({ delivery_type: 'timed', hours_before: -5 });
    expect(() => validateDeliveryConfig(config)).toThrowError(DeliveryInvalidConfigError);
  });

  it('does not throw for valid timed config', () => {
    const config = makeConfig({ delivery_type: 'timed', hours_before: 48 });
    expect(() => validateDeliveryConfig(config)).not.toThrow();
  });

  it('does not throw for manual config without hours_before', () => {
    const config = makeConfig({ delivery_type: 'manual', hours_before: null });
    expect(() => validateDeliveryConfig(config)).not.toThrow();
  });

  it('does not throw for immediate config without hours_before', () => {
    const config = makeConfig({ delivery_type: 'immediate', hours_before: null });
    expect(() => validateDeliveryConfig(config)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// shouldRetry
// ---------------------------------------------------------------------------

describe('shouldRetry', () => {
  it('returns true when retry_count = 0 and status is failed', () => {
    expect(shouldRetry(makeSchedule({ status: 'failed', retry_count: 0 }))).toBe(true);
  });

  it('returns true when retry_count = 1 and status is failed', () => {
    expect(shouldRetry(makeSchedule({ status: 'failed', retry_count: 1 }))).toBe(true);
  });

  it('returns true when retry_count = 2 and status is failed', () => {
    expect(shouldRetry(makeSchedule({ status: 'failed', retry_count: 2 }))).toBe(true);
  });

  it('returns false when retry_count = 3 (max retries reached)', () => {
    expect(shouldRetry(makeSchedule({ status: 'failed', retry_count: 3 }))).toBe(false);
  });

  it('returns false when retry_count exceeds 3', () => {
    expect(shouldRetry(makeSchedule({ status: 'failed', retry_count: 4 }))).toBe(false);
  });

  it('returns false when status is pending (not failed)', () => {
    expect(shouldRetry(makeSchedule({ status: 'pending', retry_count: 0 }))).toBe(false);
  });

  it('returns false when status is delivered', () => {
    expect(shouldRetry(makeSchedule({ status: 'delivered', retry_count: 1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildKafkaPayload
// ---------------------------------------------------------------------------

describe('buildKafkaPayload', () => {
  it('returns correct eventType', () => {
    const schedule = makeSchedule();
    const payload = buildKafkaPayload(schedule, 'user-42');
    expect(payload.eventType).toBe('ticket.delivered');
  });

  it('maps ticketId, orderId, userId correctly', () => {
    const schedule = makeSchedule({ ticket_id: 'tkt-99', order_id: 'ord-77' });
    const payload = buildKafkaPayload(schedule, 'user-42');
    expect(payload.ticketId).toBe('tkt-99');
    expect(payload.orderId).toBe('ord-77');
    expect(payload.userId).toBe('user-42');
  });

  it('includes all channels from the schedule', () => {
    const schedule = makeSchedule({ channels: ['email', 'push', 'wallet', 'sms'] });
    const payload = buildKafkaPayload(schedule, 'user-1');
    expect(payload.channels).toEqual(['email', 'push', 'wallet', 'sms']);
  });

  it('deliveredAt is a valid ISO 8601 UTC string', () => {
    const before = new Date();
    const payload = buildKafkaPayload(makeSchedule(), 'user-1');
    const after = new Date();
    const deliveredAt = new Date(payload.deliveredAt);
    expect(deliveredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(deliveredAt.getTime()).toBeLessThanOrEqual(after.getTime());
    // Must be an ISO string ending in Z
    expect(payload.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('does not carry internal schedule fields', () => {
    const payload = buildKafkaPayload(makeSchedule(), 'user-1') as Record<string, unknown>;
    expect(payload['status']).toBeUndefined();
    expect(payload['retry_count']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Extended Coverage: Embargo Release, Ticket Delivery & Batch Processing
// ---------------------------------------------------------------------------

describe('isTicketDelivered — embargo status helper', () => {
  it('returns true when delivery_status is "released"', () => {
    const { isTicketDelivered } = require('./delivery-calculator');
    expect(isTicketDelivered('released')).toBe(true);
  });

  it('returns false when delivery_status is "embargoed"', () => {
    const { isTicketDelivered } = require('./delivery-calculator');
    expect(isTicketDelivered('embargoed')).toBe(false);
  });

  it('returns true when delivery_status is undefined (no embargo)', () => {
    const { isTicketDelivered } = require('./delivery-calculator');
    expect(isTicketDelivered(undefined)).toBe(true);
  });

  it('returns true for empty string (no embargo)', () => {
    const { isTicketDelivered } = require('./delivery-calculator');
    expect(isTicketDelivered('')).toBe(true);
  });

  it('returns false for unknown status (conservative gate)', () => {
    const { isTicketDelivered } = require('./delivery-calculator');
    expect(isTicketDelivered('unknown_status')).toBe(false);
  });
});

describe('embargo release job — ticket before release_at stays embargoed', () => {
  it('ticket scheduled before release_at is not released', () => {
    const eventStart = new Date('2026-06-01T18:00:00Z');
    const schedule = makeSchedule({
      event_starts_at: eventStart,
      deliver_at: new Date('2026-05-30T18:00:00Z'), // 48h before
      status: 'pending',
    });
    const beforeDelivery = new Date('2026-05-29T18:00:00Z');
    expect(isDeliveryDue(schedule, beforeDelivery)).toBe(false);
  });

  it('ticket at exact release_at moment is due', () => {
    const deliver_at = new Date('2026-05-30T18:00:00Z');
    const schedule = makeSchedule({ deliver_at, status: 'pending' });
    expect(isDeliveryDue(schedule, deliver_at)).toBe(true);
  });

  it('ticket after release_at is due', () => {
    const deliver_at = new Date('2026-05-30T18:00:00Z');
    const schedule = makeSchedule({ deliver_at, status: 'pending' });
    const after = new Date('2026-05-31T18:00:00Z');
    expect(isDeliveryDue(schedule, after)).toBe(true);
  });
});

describe('multiple tickets batch — embargo release handling', () => {
  it('processes multiple tickets in single embargo release batch', () => {
    const baseDate = new Date('2026-05-30T18:00:00Z');
    const batch = [
      makeSchedule({ ticket_id: 'ticket-1', deliver_at: baseDate, status: 'pending' }),
      makeSchedule({ ticket_id: 'ticket-2', deliver_at: baseDate, status: 'pending' }),
      makeSchedule({ ticket_id: 'ticket-3', deliver_at: baseDate, status: 'pending' }),
    ];
    const now = new Date('2026-05-30T19:00:00Z');

    batch.forEach(schedule => {
      expect(isDeliveryDue(schedule, now)).toBe(true);
    });
  });

  it('handles mixed delivery statuses in batch (some pending, some already delivered)', () => {
    const baseDate = new Date('2026-05-30T18:00:00Z');
    const now = new Date('2026-05-30T19:00:00Z');

    const pending = makeSchedule({ ticket_id: 'ticket-1', deliver_at: baseDate, status: 'pending' });
    const delivered = makeSchedule({
      ticket_id: 'ticket-2',
      deliver_at: baseDate,
      status: 'delivered',
      delivered_at: new Date('2026-05-30T18:30:00Z'),
    });

    expect(isDeliveryDue(pending, now)).toBe(true);
    expect(isDeliveryDue(delivered, now)).toBe(false); // Already delivered
  });

  it('calculateDeliverAt handles various hour offsets correctly', () => {
    const eventStart = new Date('2026-06-01T18:00:00Z');
    const deliver24h = calculateDeliverAt(eventStart, 24);
    const deliver48h = calculateDeliverAt(eventStart, 48);
    const deliver72h = calculateDeliverAt(eventStart, 72);

    expect(deliver24h.getTime()).toBe(eventStart.getTime() - 24 * 60 * 60 * 1000);
    expect(deliver48h.getTime()).toBe(eventStart.getTime() - 48 * 60 * 60 * 1000);
    expect(deliver72h.getTime()).toBe(eventStart.getTime() - 72 * 60 * 60 * 1000);

    // Ensure order is correct
    expect(deliver72h.getTime()).toBeLessThan(deliver48h.getTime());
    expect(deliver48h.getTime()).toBeLessThan(deliver24h.getTime());
    expect(deliver24h.getTime()).toBeLessThan(eventStart.getTime());
  });

  it('buildKafkaPayload includes all channels from schedule', () => {
    const channels = ['email', 'push', 'wallet', 'sms'];
    const schedule = makeSchedule({ channels });
    const payload = buildKafkaPayload(schedule, 'user-42');
    expect(payload.channels).toEqual(channels);
  });

  it('buildKafkaPayload delivers at current time, not schedule.deliver_at', () => {
    const schedule = makeSchedule({ deliver_at: new Date('2026-05-30T18:00:00Z') });
    const before = new Date();
    const payload = buildKafkaPayload(schedule, 'user-42');
    const after = new Date();

    const deliveredAt = new Date(payload.deliveredAt);
    expect(deliveredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(deliveredAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
