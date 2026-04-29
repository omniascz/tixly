import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isTicketDelivered } from '../lib/delivery-calculator';
import { DelayedDeliveryService } from '../services/delayed-delivery.service';
import type {
  DeliveryDbAdapter,
  KafkaProducerAdapter,
} from '../services/delayed-delivery.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDbAdapter(): DeliveryDbAdapter {
  return {
    findSchedule: vi.fn(),
    findScheduleById: vi.fn(),
    findDeliveryConfig: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    findDueSchedules: vi.fn(),
    findFailedForRetry: vi.fn(),
    getUserIdForTicket: vi.fn(),
    findExpiredEmbargoes: vi.fn(),
    releaseEmbargo: vi.fn(),
  };
}

function createMockKafkaProducer(): KafkaProducerAdapter {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// isTicketDelivered — scanning gate helper
// ---------------------------------------------------------------------------

describe('isTicketDelivered', () => {
  it('returns true when delivery_status is "released"', () => {
    expect(isTicketDelivered('released')).toBe(true);
  });

  it('returns false when delivery_status is "embargoed"', () => {
    expect(isTicketDelivered('embargoed')).toBe(false);
  });

  it('returns true when delivery_status is undefined (no embargo)', () => {
    expect(isTicketDelivered(undefined)).toBe(true);
  });

  it('returns true when delivery_status is empty string', () => {
    expect(isTicketDelivered('')).toBe(true);
  });

  it('returns false for any unknown status (conservative gate)', () => {
    expect(isTicketDelivered('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// releaseExpiredEmbargoes
// ---------------------------------------------------------------------------

describe('DelayedDeliveryService.releaseExpiredEmbargoes', () => {
  let service: DelayedDeliveryService;
  let db: DeliveryDbAdapter;
  let kafka: KafkaProducerAdapter;

  beforeEach(() => {
    db = createMockDbAdapter();
    kafka = createMockKafkaProducer();
    service = new DelayedDeliveryService();
  });

  it('returns released count of 0 when no embargoes have expired', async () => {
    vi.mocked(db.findExpiredEmbargoes).mockResolvedValue([]);

    const result = await service.releaseExpiredEmbargoes(db, kafka);

    expect(result.released).toBe(0);
    expect(vi.mocked(db.releaseEmbargo)).not.toHaveBeenCalled();
  });

  it('releases each expired embargo and emits Kafka event', async () => {
    const expiredEmbargoes = [
      { ticket_id: 'ticket-1', embargo_id: 'emb-1' },
      { ticket_id: 'ticket-2', embargo_id: 'emb-2' },
    ];
    vi.mocked(db.findExpiredEmbargoes).mockResolvedValue(expiredEmbargoes);

    const result = await service.releaseExpiredEmbargoes(db, kafka);

    expect(result.released).toBe(2);
    expect(vi.mocked(db.releaseEmbargo)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.releaseEmbargo)).toHaveBeenNthCalledWith(
      1,
      'ticket-1',
      'emb-1',
    );
    expect(vi.mocked(db.releaseEmbargo)).toHaveBeenNthCalledWith(
      2,
      'ticket-2',
      'emb-2',
    );
  });

  it('publishes ticket.embargo_released to Kafka for each ticket', async () => {
    const expiredEmbargoes = [
      { ticket_id: 'ticket-1', embargo_id: 'emb-1' },
    ];
    vi.mocked(db.findExpiredEmbargoes).mockResolvedValue(expiredEmbargoes);

    await service.releaseExpiredEmbargoes(db, kafka);

    expect(vi.mocked(kafka.publish)).toHaveBeenCalledOnce();
    const call = vi.mocked(kafka.publish).mock.calls[0];
    expect(call[0]).toBe('ticket.embargo_released');
    expect(call[1]).toHaveProperty('eventType', 'ticket.embargo_released');
    expect(call[1]).toHaveProperty('ticketId', 'ticket-1');
    expect(call[1]).toHaveProperty('releasedAt');
  });

  it('continues releasing other embargoes even if one fails', async () => {
    const expiredEmbargoes = [
      { ticket_id: 'ticket-1', embargo_id: 'emb-1' },
      { ticket_id: 'ticket-2', embargo_id: 'emb-2' },
      { ticket_id: 'ticket-3', embargo_id: 'emb-3' },
    ];
    vi.mocked(db.findExpiredEmbargoes).mockResolvedValue(expiredEmbargoes);

    // Fail on ticket-2
    vi.mocked(db.releaseEmbargo).mockImplementationOnce(async () => {
      throw new Error('DB error');
    });

    const result = await service.releaseExpiredEmbargoes(db, kafka);

    // Should still try all three
    expect(vi.mocked(db.releaseEmbargo)).toHaveBeenCalledTimes(3);
    // Only ticket-1 and ticket-3 should emit events (ticket-2 failed)
    expect(vi.mocked(kafka.publish)).toHaveBeenCalledTimes(2);
    expect(result.released).toBe(2);
  });
});
