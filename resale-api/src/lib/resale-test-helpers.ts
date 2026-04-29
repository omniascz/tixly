/**
 * Vitest helpers for resale marketplace testing.
 * Factory functions and mock adapters.
 */
import { vi, type MockedFunction } from 'vitest';
import type {
  ResaleListing,
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
  GopayPreauthorizeResult,
  DbRow,
} from '../types/resale';

// ---------------------------------------------------------------------------
// Factory functions for domain objects
// ---------------------------------------------------------------------------

/**
 * Create a mock active listing with sensible defaults.
 * Default: ask_price = 500, original_price = 1000 (50% markup threshold)
 */
export function createMockListing(overrides?: Partial<ResaleListing>): ResaleListing {
  const now = new Date();
  return {
    id: 'listing-' + Math.random().toString(36).substr(2, 9),
    ticketId: 'ticket-' + Math.random().toString(36).substr(2, 9),
    sellerId: 'seller-' + Math.random().toString(36).substr(2, 9),
    buyerId: null,
    askPrice: 500,
    originalPrice: 1000,
    commissionRate: 0.05,
    status: 'active',
    escrowStatus: 'none',
    gopayPaymentId: null,
    listedAt: now,
    expiresAt: null,
    reservedUntil: null,
    soldAt: null,
    cancelledAt: null,
    payoutAmount: null,
    payoutAt: null,
    payoutRetryCount: 0,
    manualReview: false,
    ...overrides,
  };
}

/**
 * Create a mock valid ticket (status = 'valid').
 */
export function createMockTicket(overrides?: Record<string, unknown>): DbRow {
  return {
    id: 'ticket-' + Math.random().toString(36).substr(2, 9),
    owner_id: 'owner-' + Math.random().toString(36).substr(2, 9),
    ticket_type_id: 'tt-' + Math.random().toString(36).substr(2, 9),
    status: 'valid',
    original_price: '1000.00',
    totp_secret_encrypted: Buffer.alloc(32),
    totp_secret_iv: Buffer.alloc(12),
    device_binding_id: null,
    transfer_count: 0,
    ...overrides,
  };
}

/**
 * Create a mock GoPay AUTHORIZED response.
 */
export function createMockGopayResponse(overrides?: Partial<GopayPreauthorizeResult>): GopayPreauthorizeResult {
  return {
    paymentId: 'gopay-' + Math.random().toString(36).substr(2, 9),
    redirectUrl: 'https://gw.gopay.cz/gw/v3/pay?token=mock123',
    ...overrides,
  };
}

/**
 * Create a mock event.
 */
export function createMockEvent(overrides?: Record<string, unknown>): DbRow {
  return {
    id: 'event-' + Math.random().toString(36).substr(2, 9),
    resale_allowed: true,
    date_start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock ticket type.
 */
export function createMockTicketType(overrides?: Record<string, unknown>): DbRow {
  return {
    id: 'tt-' + Math.random().toString(36).substr(2, 9),
    event_id: 'event-' + Math.random().toString(36).substr(2, 9),
    zone: 'A',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock adapter factories
// ---------------------------------------------------------------------------

/**
 * In-memory mock DB adapter with common query patterns.
 */
export function createMockDB(): DbAdapter & {
  storage: {
    listings: Map<string, DbRow>;
    tickets: Map<string, DbRow>;
    events: Map<string, DbRow>;
    ticketTypes: Map<string, DbRow>;
    transferLogs: DbRow[];
  };
} {
  const storage = {
    listings: new Map<string, DbRow>(),
    tickets: new Map<string, DbRow>(),
    events: new Map<string, DbRow>(),
    ticketTypes: new Map<string, DbRow>(),
    transferLogs: [] as DbRow[],
  };

  return {
    storage,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // Basic pattern matching for common queries
      if (sql.includes('SELECT') && sql.includes('FROM')) {
        // For testing purposes, return empty by default
        // Tests will override specific queries
        return [] as DbRow[];
      }
      return [] as DbRow[];
    }),
    transaction: vi.fn(async (fn) => {
      // Simple transaction — no isolation, just pass the adapter
      return fn(this);
    }),
  };
}

/**
 * Mock Redis adapter.
 */
export function createMockRedis(): RedisAdapter {
  const store = new Map<string, { value: string; expiresAt: number }>();

  return {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, ttlSeconds: number) => {
      store.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

/**
 * Mock Kafka/EventBus adapter that records emitted events.
 */
export function createMockEventBus(): EventBusAdapter & {
  events: Array<{ topic: string; payload: unknown }>;
} {
  const events: Array<{ topic: string; payload: unknown }> = [];

  return {
    events,
    publish: vi.fn(async (topic: string, payload: unknown) => {
      events.push({ topic, payload });
    }),
  };
}

/**
 * Mock GoPay adapter with preauth, capture, void.
 */
export function createMockGopay(): GopayAdapter & {
  preauthorizeCalls: Array<Record<string, unknown>>;
  captureCalls: string[];
  voidCalls: string[];
} {
  const preauthorizeCalls: Array<Record<string, unknown>> = [];
  const captureCalls: string[] = [];
  const voidCalls: string[] = [];

  return {
    preauthorizeCalls,
    captureCalls,
    voidCalls,
    preauthorize: vi.fn(async (params: Record<string, unknown>) => {
      preauthorizeCalls.push(params);
      return createMockGopayResponse();
    }),
    capture: vi.fn(async (paymentId: string) => {
      captureCalls.push(paymentId);
    }),
    voidAuthorization: vi.fn(async (paymentId: string) => {
      voidCalls.push(paymentId);
    }),
    payout: vi.fn(async () => undefined),
    verifyHmacSignature: vi.fn((payload: string, signature: string) => true),
  };
}

/**
 * Mock push notification adapter.
 */
export function createMockPushNotification(): PushNotificationAdapter & {
  messages: Array<{ userId: string; message: { title: string; body: string; data?: Record<string, string> } }>;
} {
  const messages: Array<{ userId: string; message: { title: string; body: string; data?: Record<string, string> } }> = [];

  return {
    messages,
    send: vi.fn(async (userId: string, message: { title: string; body: string; data?: Record<string, string> }) => {
      messages.push({ userId, message });
    }),
  };
}

// ---------------------------------------------------------------------------
// Service setup helper
// ---------------------------------------------------------------------------

/**
 * Create a complete service instance with all mocked adapters.
 * Useful for integration-style tests.
 */
export function createMockServiceContext(overrides?: {
  db?: DbAdapter;
  redis?: RedisAdapter;
  eventBus?: EventBusAdapter;
  gopay?: GopayAdapter;
  push?: PushNotificationAdapter;
}) {
  return {
    db: overrides?.db ?? createMockDB(),
    redis: overrides?.redis ?? createMockRedis(),
    eventBus: overrides?.eventBus ?? createMockEventBus(),
    gopay: overrides?.gopay ?? createMockGopay(),
    push: overrides?.push ?? createMockPushNotification(),
  };
}
