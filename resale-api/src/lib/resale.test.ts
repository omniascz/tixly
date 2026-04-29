/**
 * Unit tests for the resale marketplace service layer.
 * All adapters are mocked — no DB, Redis, or GoPay calls.
 *
 * Run with: vitest src/lib/resale.test.ts
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { ResaleListingService } from '../services/resale-listing.service';
import { WatchlistService } from '../services/watchlist.service';
import type {
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
  DbRow,
} from '../types/resale';
import {
  PriceCapViolationError,
  FraudSuspectedError,
  ResaleNotAllowedError,
  DuplicateListingError,
  ListingUnavailableError,
  SelfPurchaseError,
} from './resale-errors';

// ---------------------------------------------------------------------------
// Adapter mock factories
// ---------------------------------------------------------------------------

function makeDb(): DbAdapter {
  return {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn(makeDb())),
  };
}

function makeRedis(): RedisAdapter {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

function makeEventBus(): EventBusAdapter {
  return { publish: vi.fn() };
}

function makeGopay(): GopayAdapter {
  return {
    preauthorize: vi.fn(),
    capture: vi.fn(),
    voidAuthorization: vi.fn(),
    payout: vi.fn(),
    verifyHmacSignature: vi.fn(),
  };
}

function makePush(): PushNotificationAdapter {
  return { send: vi.fn() };
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const SELLER_ID = 'seller-uuid-001';
const BUYER_ID = 'buyer-uuid-002';
const TICKET_ID = 'ticket-uuid-abc';
const LISTING_ID = 'listing-uuid-xyz';
const TICKET_TYPE_ID = 'tt-uuid-001';
const EVENT_ID = 'event-uuid-001';

const BASE_TICKET_ROW = {
  id: TICKET_ID,
  owner_id: SELLER_ID,
  ticket_type_id: TICKET_TYPE_ID,
  status: 'valid',
  original_price: '1000.00',
  totp_secret_encrypted: Buffer.alloc(32),
  totp_secret_iv: Buffer.alloc(12),
  device_binding_id: null,
  transfer_count: 0,
};

const BASE_TICKET_TYPE_ROW = {
  id: TICKET_TYPE_ID,
  event_id: EVENT_ID,
  zone: 'A',
};

const BASE_EVENT_ROW = {
  id: EVENT_ID,
  resale_allowed: true,
  date_start: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
};

const BASE_LISTING_ROW = {
  id: LISTING_ID,
  ticket_id: TICKET_ID,
  seller_id: SELLER_ID,
  buyer_id: null,
  ask_price: '900.00',
  original_price: '1000.00',
  commission_rate: '0.05',
  status: 'active',
  escrow_status: 'none',
  escrow_gopay_id: null,
  listed_at: new Date().toISOString(),
  expires_at: null,
  reserved_until: null,
  sold_at: null,
  cancelled_at: null,
  payout_amount: null,
  payout_at: null,
  payout_retry_count: 0,
  manual_review: false,
};

// ---------------------------------------------------------------------------
// Helper: set up service under test
// ---------------------------------------------------------------------------

function makeService(overrides?: {
  db?: DbAdapter;
  redis?: RedisAdapter;
  eventBus?: EventBusAdapter;
  gopay?: GopayAdapter;
  push?: PushNotificationAdapter;
}): { service: ResaleListingService; db: DbAdapter; redis: RedisAdapter; eventBus: EventBusAdapter; gopay: GopayAdapter; push: PushNotificationAdapter } {
  const db = overrides?.db ?? makeDb();
  const redis = overrides?.redis ?? makeRedis();
  const eventBus = overrides?.eventBus ?? makeEventBus();
  const gopay = overrides?.gopay ?? makeGopay();
  const push = overrides?.push ?? makePush();
  return {
    service: new ResaleListingService(db, redis, eventBus, gopay, push),
    db,
    redis,
    eventBus,
    gopay,
    push,
  };
}

// ---------------------------------------------------------------------------
// createListing tests
// ---------------------------------------------------------------------------

describe('ResaleListingService.createListing', () => {
  it('creates a valid listing and emits Kafka event', async () => {
    const { service, db, eventBus } = makeService();

    const dbQuery = db.query as MockedFunction<DbAdapter['query']>;
    const dbTx = db.transaction as MockedFunction<DbAdapter['transaction']>;

    // Sequence of queries: ticket → ticket_type → event → duplicate check
    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])   // ticket
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[]) // ticket_type
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[])    // event
      .mockResolvedValueOnce([] as DbRow[]);                             // no duplicate

    // Transaction: INSERT listing + UPDATE ticket
    dbTx.mockImplementation(async (fn) => {
      const txDb = makeDb();
      (txDb.query as MockedFunction<DbAdapter['query']>)
        .mockResolvedValueOnce([{ ...BASE_LISTING_ROW, ask_price: '900.00' }] as unknown as DbRow[])
        .mockResolvedValueOnce([] as DbRow[]);
      return fn(txDb);
    });

    const listing = await service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 900 });

    expect(listing.askPrice).toBe(900);
    expect(listing.originalPrice).toBe(1000);
    expect(listing.status).toBe('active');
    expect(listing.commissionRate).toBe(0.05);

    expect(eventBus.publish).toHaveBeenCalledWith('resale.listing.created', expect.objectContaining({
      ticketId: TICKET_ID,
      sellerId: SELLER_ID,
      askPrice: 900,
    }));
  });

  it('throws PriceCapViolationError when ask_price > 110% of original_price (EU cap)', async () => {
    const { service, db } = makeService();

    // original_price = 1000, cap = floor(1.10 × 1000) = 1100
    // askPrice 1101 exceeds cap → PriceCapViolationError
    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[]);

    await expect(
      service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 1101 }),
    ).rejects.toThrow(PriceCapViolationError);
  });

  it('allows ask_price = exactly 110% of original_price (at EU cap boundary)', async () => {
    const { service, db } = makeService();

    const dbQuery = db.query as MockedFunction<DbAdapter['query']>;
    const dbTx = db.transaction as MockedFunction<DbAdapter['transaction']>;

    // askPrice 1100 = floor(1.10 × 1000) → exactly at cap, should be allowed
    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([] as DbRow[]);

    dbTx.mockImplementation(async (fn) => {
      const txDb = makeDb();
      (txDb.query as MockedFunction<DbAdapter['query']>)
        .mockResolvedValueOnce([{ ...BASE_LISTING_ROW, ask_price: '1100.00' }] as unknown as DbRow[])
        .mockResolvedValueOnce([] as DbRow[]);
      return fn(txDb);
    });

    const listing = await service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 1100 });
    expect(listing.askPrice).toBe(1100);
  });

  it('throws FraudSuspectedError when ask_price < 50% of original_price', async () => {
    const { service, db } = makeService();

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[]);

    // 499 < 50% × 1000 = 500 → fraud
    await expect(
      service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 499 }),
    ).rejects.toThrow(FraudSuspectedError);
  });

  it('allows ask_price = exactly 50% of original_price (boundary)', async () => {
    const { service, db } = makeService();

    const dbQuery = db.query as MockedFunction<DbAdapter['query']>;
    const dbTx = db.transaction as MockedFunction<DbAdapter['transaction']>;

    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([] as DbRow[]);

    dbTx.mockImplementation(async (fn) => {
      const txDb = makeDb();
      (txDb.query as MockedFunction<DbAdapter['query']>)
        .mockResolvedValueOnce([{ ...BASE_LISTING_ROW, ask_price: '500.00' }] as unknown as DbRow[])
        .mockResolvedValueOnce([] as DbRow[]);
      return fn(txDb);
    });

    const listing = await service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 500 });
    expect(listing.askPrice).toBe(500);
  });

  it('throws ResaleNotAllowedError when event.resale_allowed = false', async () => {
    const { service, db } = makeService();

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([{ ...BASE_EVENT_ROW, resale_allowed: false }] as unknown as DbRow[]);

    await expect(
      service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 900 }),
    ).rejects.toThrow(ResaleNotAllowedError);
  });

  it('throws DuplicateListingError when active listing already exists for ticket', async () => {
    const { service, db } = makeService();

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_EVENT_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([{ id: 'existing-listing-id' }] as unknown as DbRow[]); // duplicate

    await expect(
      service.createListing(SELLER_ID, { ticketId: TICKET_ID, askPrice: 900 }),
    ).rejects.toThrow(DuplicateListingError);
  });
});

// ---------------------------------------------------------------------------
// purchaseListing tests
// ---------------------------------------------------------------------------

describe('ResaleListingService.purchaseListing', () => {
  it('reserves the listing and returns GoPay redirect URL', async () => {
    const { service, db, gopay } = makeService();

    const reservedListing = {
      ...BASE_LISTING_ROW,
      status: 'reserved',
      buyer_id: BUYER_ID,
      reserved_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([reservedListing] as unknown as DbRow[])  // atomic UPDATE...RETURNING
      .mockResolvedValueOnce([] as DbRow[]);                            // UPDATE escrow_gopay_id

    (gopay.preauthorize as MockedFunction<GopayAdapter['preauthorize']>).mockResolvedValue({
      paymentId: 'gopay-pay-001',
      redirectUrl: 'https://gw.gopay.cz/gw/v3/pay?token=abc123',
    });

    const result = await service.purchaseListing(BUYER_ID, { listingId: LISTING_ID });

    expect(result.gopayRedirectUrl).toBe('https://gw.gopay.cz/gw/v3/pay?token=abc123');
    expect(result.listing.status).toBe('reserved');
    expect(gopay.preauthorize).toHaveBeenCalledWith(expect.objectContaining({
      amount: 900,
      currency: 'CZK',
    }));
  });

  it('throws ListingUnavailableError when listing is already reserved (race condition)', async () => {
    const { service, db } = makeService();

    // UPDATE affected 0 rows → listing was snapped up by another buyer
    (db.query as MockedFunction<DbAdapter['query']>).mockResolvedValueOnce([] as DbRow[]);

    await expect(
      service.purchaseListing(BUYER_ID, { listingId: LISTING_ID }),
    ).rejects.toThrow(ListingUnavailableError);
  });

  it('throws SelfPurchaseError when buyer = seller', async () => {
    const { service, db } = makeService();

    const reservedBySeller = {
      ...BASE_LISTING_ROW,
      status: 'reserved',
      buyer_id: SELLER_ID, // same as seller_id
      reserved_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([reservedBySeller] as unknown as DbRow[]) // UPDATE...RETURNING
      .mockResolvedValueOnce([] as DbRow[]);                           // rollback UPDATE

    await expect(
      service.purchaseListing(SELLER_ID, { listingId: LISTING_ID }),
    ).rejects.toThrow(SelfPurchaseError);
  });
});

// ---------------------------------------------------------------------------
// handleClaimTimeout tests
// ---------------------------------------------------------------------------

describe('ResaleListingService.handleClaimTimeout', () => {
  it('rolls back TOTP secret and voids GoPay authorization on claim timeout', async () => {
    const { service, db, gopay, push } = makeService();

    const soldListing = {
      ...BASE_LISTING_ROW,
      status: 'sold',
      escrow_status: 'held',
      escrow_gopay_id: 'gopay-pay-001',
      buyer_id: BUYER_ID,
      // sold 5 hours ago → 4h claim window expired
      sold_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    };

    const transferLog = {
      id: 'log-uuid-001',
      listing_id: LISTING_ID,
      ticket_id: TICKET_ID,
      old_totp_secret_encrypted: Buffer.alloc(48),
      old_totp_secret_iv: Buffer.alloc(12),
      transferred_at: soldListing.sold_at,
    };

    const dbQuery = db.query as MockedFunction<DbAdapter['query']>;
    const dbTx = db.transaction as MockedFunction<DbAdapter['transaction']>;

    dbQuery
      .mockResolvedValueOnce([soldListing] as unknown as DbRow[])   // load listing
      .mockResolvedValueOnce([transferLog] as unknown as DbRow[]);  // load transfer log

    dbTx.mockImplementation(async (fn) => {
      const txDb = makeDb();
      (txDb.query as MockedFunction<DbAdapter['query']>)
        .mockResolvedValueOnce([] as DbRow[]) // UPDATE tickets (restore TOTP)
        .mockResolvedValueOnce([] as DbRow[]); // UPDATE resale_listings (reset to active)
      return fn(txDb);
    });

    (gopay.voidAuthorization as MockedFunction<GopayAdapter['voidAuthorization']>).mockResolvedValue(undefined);

    await service.handleClaimTimeout(LISTING_ID);

    expect(gopay.voidAuthorization).toHaveBeenCalledWith('gopay-pay-001');
    // Push notifications sent to both parties
    expect(push.send).toHaveBeenCalledTimes(2);
    expect(push.send).toHaveBeenCalledWith(SELLER_ID, expect.objectContaining({ title: 'Ticket transfer expired' }));
    expect(push.send).toHaveBeenCalledWith(BUYER_ID, expect.objectContaining({ title: 'Payment cancelled' }));
  });

  it('does nothing when claim window has not yet expired', async () => {
    const { service, db, gopay } = makeService();

    const soldListingFresh = {
      ...BASE_LISTING_ROW,
      status: 'sold',
      escrow_status: 'held',
      escrow_gopay_id: 'gopay-pay-001',
      buyer_id: BUYER_ID,
      // sold only 1 hour ago → still within 4h window
      sold_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    };

    (db.query as MockedFunction<DbAdapter['query']>).mockResolvedValueOnce([soldListingFresh] as unknown as DbRow[]);

    await service.handleClaimTimeout(LISTING_ID);

    expect(gopay.voidAuthorization).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// autoDelistExpired tests
// ---------------------------------------------------------------------------

describe('ResaleListingService.autoDelistExpired', () => {
  it('does NOT delist a listing 23 hours before the event', async () => {
    const { service, db } = makeService();

    // Query returns empty — no listings meet the 24h threshold
    (db.query as MockedFunction<DbAdapter['query']>).mockResolvedValueOnce([] as DbRow[]);

    const count = await service.autoDelistExpired();
    expect(count).toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('delists listings 25 hours before the event', async () => {
    const { service, db } = makeService();

    const expiringSoon = {
      id: LISTING_ID,
      ticket_id: TICKET_ID,
    };

    const dbQuery = db.query as MockedFunction<DbAdapter['query']>;
    const dbTx = db.transaction as MockedFunction<DbAdapter['transaction']>;

    // Listings found within threshold
    dbQuery.mockResolvedValueOnce([expiringSoon] as unknown as DbRow[]);

    dbTx.mockImplementation(async (fn) => {
      const txDb = makeDb();
      (txDb.query as MockedFunction<DbAdapter['query']>)
        .mockResolvedValueOnce([] as DbRow[]) // UPDATE resale_listings SET status = 'expired'
        .mockResolvedValueOnce([] as DbRow[]); // UPDATE tickets SET status = 'valid'
      return fn(txDb);
    });

    const count = await service.autoDelistExpired();
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Watchlist throttling tests
// ---------------------------------------------------------------------------

describe('WatchlistService.notifyWatchlistUsers — throttling', () => {
  const WATCHLIST_ENTRY = {
    id: 'wl-uuid-001',
    user_id: BUYER_ID,
    event_id: EVENT_ID,
    max_price: '1000.00',
    zone: 'A',
    notified_at: null,
    created_at: new Date().toISOString(),
  };

  const LISTING = {
    id: LISTING_ID,
    ticketId: TICKET_ID,
    sellerId: SELLER_ID,
    buyerId: null,
    askPrice: 900,
    originalPrice: 1000,
    commissionRate: 0.05,
    status: 'active' as const,
    escrowStatus: 'none' as const,
    gopayPaymentId: null,
    listedAt: new Date(),
    expiresAt: null,
    reservedUntil: null,
    soldAt: null,
    cancelledAt: null,
    payoutAmount: null,
    payoutAt: null,
    payoutRetryCount: 0,
    manualReview: false,
  };

  it('sends notification on first listing and sets Redis throttle key', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const eventBus = makeEventBus();

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([{ event_id: EVENT_ID, zone: 'A' }] as unknown as DbRow[]) // ticket_type join
      .mockResolvedValueOnce([WATCHLIST_ENTRY] as unknown as DbRow[])                   // watchlist match
      .mockResolvedValueOnce([] as DbRow[]);                                            // UPDATE notified_at

    (redis.get as MockedFunction<RedisAdapter['get']>).mockResolvedValue(null); // not throttled
    (redis.set as MockedFunction<RedisAdapter['set']>).mockResolvedValue(undefined);

    const watchlistService = new WatchlistService(db, redis, eventBus);
    await watchlistService.notifyWatchlistUsers(LISTING);

    expect(redis.set).toHaveBeenCalledWith(
      `watchlist:notified:${BUYER_ID}:${EVENT_ID}`,
      '1',
      300,
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      'notification.watchlist.match',
      expect.objectContaining({ userId: BUYER_ID, listingId: LISTING_ID }),
    );
  });

  it('skips second notification within 5-minute throttle window', async () => {
    const db = makeDb();
    const redis = makeRedis();
    const eventBus = makeEventBus();

    (db.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([{ event_id: EVENT_ID, zone: 'A' }] as unknown as DbRow[])
      .mockResolvedValueOnce([WATCHLIST_ENTRY] as unknown as DbRow[]);

    // Redis has throttle key → already notified within window
    (redis.get as MockedFunction<RedisAdapter['get']>).mockResolvedValue('1');

    const watchlistService = new WatchlistService(db, redis, eventBus);
    await watchlistService.notifyWatchlistUsers(LISTING);

    expect(redis.set).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
