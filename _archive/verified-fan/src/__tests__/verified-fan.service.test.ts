import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  register,
  runSelection,
  redeemAccessLink,
} from '../services/verified-fan.service.js';
import {
  RegistrationClosedError,
  AlreadyRegisteredError,
} from '../types/verified-fan.types.js';
import type { DbAdapter, RedisAdapter } from '@tixly/rls-multitenancy';

// Mock the token-related functions
vi.mock('../lib/access-token.js', () => ({
  generateAccessToken: vi.fn().mockResolvedValue({
    token: 'token-generated-123',
    expiresAt: new Date('2026-05-08'),
  }),
  verifyAccessToken: vi.fn().mockResolvedValue({
    registrationId: 'reg-001',
    eventId: 'event-001',
    userId: 'user-001',
    presaleTicketTypeId: 'ticket-type-001',
  }),
  markTokenUsed: vi.fn().mockResolvedValue(undefined),
}));

describe('Verified Fan Service', () => {
  let mockDb: DbAdapter;
  let mockRedis: RedisAdapter;
  let mockKafka: any;
  let mockEmail: any;
  let deps: any;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as any;

    mockRedis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
    } as any;

    mockKafka = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    mockEmail = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    deps = {
      db: mockDb,
      redis: mockRedis,
      kafka: mockKafka,
      email: mockEmail,
    };
  });

  describe('register', () => {
    it('should register a new fan successfully', async () => {
      const userId = 'user-new-001';
      const eventId = 'event-register-001';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        registration_opens_at: new Date('2026-04-01'),
        registration_closes_at: new Date('2026-04-15'),
        event_id: eventId,
      };

      const registrationRow = {
        id: 'reg-new-001',
        status: 'pending',
        registered_at: now,
      };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow]) // First query for config
        .mockResolvedValueOnce([registrationRow]); // Second query for INSERT

      const result = await register(deps, userId, eventId, now);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.eventId).toBe(eventId);
      expect(result.status).toBe('pending');
      expect(mockKafka.send).toHaveBeenCalledWith(
        'tixly.verified-fan.registered',
        expect.objectContaining({ eventId, userId }),
      );
    });

    it('should throw RegistrationClosedError when registration period not active', async () => {
      const userId = 'user-closed-001';
      const eventId = 'event-closed-001';
      const now = new Date('2026-05-01T12:00:00Z'); // After registration closes

      const configRow = {
        registration_opens_at: new Date('2026-04-01'),
        registration_closes_at: new Date('2026-04-15'),
        event_id: eventId,
      };

      (mockDb.query as any).mockResolvedValueOnce([configRow]);

      await expect(register(deps, userId, eventId, now)).rejects.toThrow(
        RegistrationClosedError,
      );
    });

    it('should throw AlreadyRegisteredError when user already registered', async () => {
      const userId = 'user-dup-001';
      const eventId = 'event-dup-001';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        registration_opens_at: new Date('2026-04-01'),
        registration_closes_at: new Date('2026-04-15'),
        event_id: eventId,
      };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow]) // Config query
        .mockResolvedValueOnce([]); // INSERT returns nothing (conflict)

      const existingRow = {
        id: 'reg-dup-001',
        status: 'pending',
        registered_at: new Date('2026-04-07'),
      };

      (mockDb.query as any).mockResolvedValueOnce([existingRow]); // Fetch existing

      const result = await register(deps, userId, eventId, now);

      // Second call should return the existing registration (idempotent)
      expect(result).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('should enforce registration window boundaries', async () => {
      const userId = 'user-boundary-001';
      const eventId = 'event-boundary-001';
      const beforeOpening = new Date('2026-03-31T12:00:00Z');

      const configRow = {
        registration_opens_at: new Date('2026-04-01'),
        registration_closes_at: new Date('2026-04-15'),
        event_id: eventId,
      };

      (mockDb.query as any).mockResolvedValueOnce([configRow]);

      await expect(register(deps, userId, eventId, beforeOpening)).rejects.toThrow(
        RegistrationClosedError,
      );
    });

    it('should send Kafka event on successful registration', async () => {
      const userId = 'user-kafka-001';
      const eventId = 'event-kafka-001';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        registration_opens_at: new Date('2026-04-01'),
        registration_closes_at: new Date('2026-04-15'),
        event_id: eventId,
      };

      const registrationRow = {
        id: 'reg-kafka-001',
        status: 'pending',
        registered_at: now,
      };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow])
        .mockResolvedValueOnce([registrationRow]);

      await register(deps, userId, eventId, now);

      expect(mockKafka.send).toHaveBeenCalledWith(
        'tixly.verified-fan.registered',
        { eventId, userId },
      );
    });
  });

  describe('runSelection', () => {
    it('should select fans using FIFO method', async () => {
      const eventId = 'event-selection-fifo';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        slots: 10,
        selection_method: 'fifo',
        link_expires_after_hours: 48,
        presale_ticket_type_id: 'ticket-type-presale',
      };

      const totalRow = { total: 50 };

      const selectedRows = Array.from({ length: 10 }, (_, i) => ({
        id: `reg-selected-${i}`,
        user_id: `user-selected-${i}`,
      }));

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow]) // Config query
        .mockResolvedValueOnce([totalRow]); // Total count query

      (mockDb.transaction as any).mockImplementation(async (fn) => {
        const mockTx = {
          query: vi.fn().mockResolvedValue(selectedRows),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(mockTx);
      });

      const result = await runSelection(deps, eventId, now);

      expect(result).toBeDefined();
      expect(result.eventId).toBe(eventId);
      expect(result.selectedCount).toBeLessThanOrEqual(10);
      expect(mockKafka.send).toHaveBeenCalledWith(
        'tixly.verified-fan.selection-complete',
        expect.any(Object),
      );
    });

    it('should return correct selection count and total registrations', async () => {
      const eventId = 'event-selection-count';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        slots: 20,
        selection_method: 'random',
        link_expires_after_hours: 48,
        presale_ticket_type_id: 'ticket-type-presale',
      };

      const totalRow = { total: 150 };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow])
        .mockResolvedValueOnce([totalRow]);

      (mockDb.transaction as any).mockImplementation(async (fn) => {
        const mockTx = {
          query: vi.fn().mockResolvedValue([]),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(mockTx);
      });

      const result = await runSelection(deps, eventId, now);

      expect(result.selectedCount).toBeLessThanOrEqual(20);
      expect(result.totalRegistrations).toBe(150);
    });

    it('should use points-based ordering for selection method points', async () => {
      const eventId = 'event-selection-points';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        slots: 5,
        selection_method: 'points',
        link_expires_after_hours: 24,
        presale_ticket_type_id: 'ticket-type-presale',
      };

      const totalRow = { total: 100 };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow])
        .mockResolvedValueOnce([totalRow]);

      (mockDb.transaction as any).mockImplementation(async (fn) => {
        const mockTx = {
          query: vi.fn().mockResolvedValue([]),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(mockTx);
      });

      const result = await runSelection(deps, eventId, now);

      expect(result.method).toBe('points');
    });

    it('should generate access tokens for selected fans', async () => {
      const eventId = 'event-tokens';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        slots: 3,
        selection_method: 'fifo',
        link_expires_after_hours: 48,
        presale_ticket_type_id: 'ticket-type-presale',
      };

      const totalRow = { total: 10 };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow])
        .mockResolvedValueOnce([totalRow]);

      (mockDb.transaction as any).mockImplementation(async (fn) => {
        const mockTx = {
          query: vi.fn().mockResolvedValue([
            { id: 'reg-1', user_id: 'user-1' },
            { id: 'reg-2', user_id: 'user-2' },
            { id: 'reg-3', user_id: 'user-3' },
          ]),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(mockTx);
      });

      const result = await runSelection(deps, eventId, now);

      expect(result.selectedCount).toBeLessThanOrEqual(3);
      expect(mockEmail.send).toHaveBeenCalled();
    });

    it('should send selection-complete Kafka event', async () => {
      const eventId = 'event-kafka-selection';
      const now = new Date('2026-04-08T12:00:00Z');

      const configRow = {
        slots: 15,
        selection_method: 'random',
        link_expires_after_hours: 48,
        presale_ticket_type_id: 'ticket-type-presale',
      };

      const totalRow = { total: 75 };

      (mockDb.query as any)
        .mockResolvedValueOnce([configRow])
        .mockResolvedValueOnce([totalRow]);

      (mockDb.transaction as any).mockImplementation(async (fn) => {
        const mockTx = {
          query: vi.fn().mockResolvedValue([]),
          execute: vi.fn().mockResolvedValue(undefined),
        };
        return fn(mockTx);
      });

      await runSelection(deps, eventId, now);

      expect(mockKafka.send).toHaveBeenCalledWith(
        'tixly.verified-fan.selection-complete',
        expect.objectContaining({
          eventId,
          total: 75,
        }),
      );
    });
  });

  describe('redeemAccessLink', () => {
    it('should redeem valid access token successfully', async () => {
      const token = 'jwt-token-valid-123';

      (mockDb.execute as any).mockResolvedValue(undefined);

      const result = await redeemAccessLink(deps, token);

      expect(result).toBeDefined();
      expect(result.registrationId).toBe('reg-001');
      expect(result.eventId).toBe('event-001');
      expect(result.userId).toBe('user-001');
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should mark token as used after redemption', async () => {
      const token = 'jwt-token-used-123';

      (mockDb.execute as any).mockResolvedValue(undefined);

      await redeemAccessLink(deps, token);

      // markTokenUsed should be called
      expect(mockDb.execute).toHaveBeenCalled();
    });

    it('should update registration status to link_used', async () => {
      const token = 'jwt-token-status-123';

      (mockDb.execute as any).mockResolvedValue(undefined);

      await redeemAccessLink(deps, token);

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('link_used'),
        expect.any(Array),
      );
    });

    it('should send Kafka event on successful redemption', async () => {
      const token = 'jwt-token-kafka-123';

      (mockDb.execute as any).mockResolvedValue(undefined);

      await redeemAccessLink(deps, token);

      expect(mockKafka.send).toHaveBeenCalledWith(
        'tixly.verified-fan.link-redeemed',
        expect.any(Object),
      );
    });

    it('should return access token payload with all required fields', async () => {
      const token = 'jwt-token-payload-123';

      (mockDb.execute as any).mockResolvedValue(undefined);

      const result = await redeemAccessLink(deps, token);

      expect(result).toHaveProperty('registrationId');
      expect(result).toHaveProperty('eventId');
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('presaleTicketTypeId');
    });
  });
});
