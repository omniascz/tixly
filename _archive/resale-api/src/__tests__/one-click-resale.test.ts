/**
 * Feature #46 — 1-click resale listing from "Moje vstupenky".
 *
 * Tests the ResaleListingService.createOneClickListing method and the
 * free-function shim. All adapters are mocked — no DB, Redis, or GoPay
 * calls. Run with: vitest src/__tests__/one-click-resale.test.ts
 */
import { describe, it, expect, vi, type MockedFunction } from 'vitest';
import {
  ResaleListingService,
  createOneClickListing,
  type ServiceDeps,
} from '../services/resale-listing.service.js';
import type {
  DbAdapter,
  RedisAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
  DbRow,
} from '../types/resale.js';
import {
  TicketOwnershipError,
  ResaleNotAllowedError,
  TicketNotValidError,
  DuplicateListingError,
  EventTooSoonError,
} from '../lib/resale-errors.js';

// ---------------------------------------------------------------------------
// Mock adapter factories
// ---------------------------------------------------------------------------

function makeDb(): DbAdapter {
  return {
    query: vi.fn(),
    transaction: vi.fn((fn) => fn(makeDb())),
  } as unknown as DbAdapter;
}

function makeDeps(dbOverride?: DbAdapter): ServiceDeps & { db: DbAdapter } {
  const db = dbOverride ?? makeDb();
  return {
    db,
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    eventBus: { publish: vi.fn() },
    gopay: {
      preauthorize: vi.fn(),
      capture: vi.fn(),
      voidAuthorization: vi.fn(),
      payout: vi.fn(),
      verifyHmacSignature: vi.fn(),
    },
    push: { send: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const SELLER_ID = 'seller-uuid-001';
const TICKET_ID = 'ticket-uuid-abc';
const LISTING_ID = 'listing-uuid-xyz';
const TICKET_TYPE_ID = 'tt-uuid-001';
const EVENT_ID = 'event-uuid-001';

const ORIGINAL_PRICE_HALERE = 100000; // 1000 CZK = 100 000 halířů

const BASE_TICKET_ROW = {
  id: TICKET_ID,
  owner_id: SELLER_ID,
  ticket_type_id: TICKET_TYPE_ID,
  status: 'valid',
  original_price: String(ORIGINAL_PRICE_HALERE),
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

function eventRow(dateStart: Date, resaleAllowed = true) {
  return {
    id: EVENT_ID,
    resale_allowed: resaleAllowed,
    date_start: dateStart.toISOString(),
  };
}

function listingRow(expiresAt: Date) {
  return {
    id: LISTING_ID,
    ticket_id: TICKET_ID,
    seller_id: SELLER_ID,
    buyer_id: null,
    ask_price: String(ORIGINAL_PRICE_HALERE),
    original_price: String(ORIGINAL_PRICE_HALERE),
    commission_rate: '0.05',
    status: 'active',
    escrow_status: 'none',
    escrow_gopay_id: null,
    listed_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    reserved_until: null,
    sold_at: null,
    cancelled_at: null,
    payout_amount: null,
    payout_at: null,
    payout_retry_count: 0,
    manual_review: false,
  };
}

/**
 * Sets up the full query sequence for a happy-path createOneClickListing call:
 *   1) ticket (outer pre-flight)
 *   2) ticket_type (outer pre-flight)
 *   3) event (outer pre-flight)
 *   4) ticket (createListing)
 *   5) ticket_type (createListing)
 *   6) event (createListing)
 *   7) duplicate-check → empty
 * Transaction: (insert listing, update ticket)
 */
function primeHappyPath(deps: ServiceDeps, dateStart: Date): Date {
  const expectedExpiresAt = new Date(dateStart.getTime() - 24 * 60 * 60 * 1000);
  const dbQuery = deps.db.query as MockedFunction<DbAdapter['query']>;
  const dbTx = deps.db.transaction as MockedFunction<DbAdapter['transaction']>;

  dbQuery
    .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
    .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
    .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[])
    .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
    .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
    .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[])
    .mockResolvedValueOnce([] as DbRow[]);

  dbTx.mockImplementation(async (fn) => {
    const txDb = makeDb();
    (txDb.query as MockedFunction<DbAdapter['query']>)
      .mockResolvedValueOnce([listingRow(expectedExpiresAt)] as unknown as DbRow[])
      .mockResolvedValueOnce([] as DbRow[]);
    return fn(txDb);
  });

  return expectedExpiresAt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createOneClickListing (Feature #46)', () => {
  it('happy path: creates listing with askPrice = original_price and expiresAt = event.date_start - 24h', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const expectedExpiresAt = primeHappyPath(deps, dateStart);

    const listing = await createOneClickListing(TICKET_ID, SELLER_ID, deps);

    expect(listing.askPrice).toBe(ORIGINAL_PRICE_HALERE);
    expect(listing.originalPrice).toBe(ORIGINAL_PRICE_HALERE);
    expect(listing.status).toBe('active');
    expect(listing.expiresAt).not.toBeNull();
    expect(listing.expiresAt!.getTime()).toBe(expectedExpiresAt.getTime());

    expect(deps.eventBus.publish).toHaveBeenCalledWith(
      'resale.listing.created',
      expect.objectContaining({ ticketId: TICKET_ID, sellerId: SELLER_ID, askPrice: ORIGINAL_PRICE_HALERE }),
    );
  });

  it('throws TicketOwnershipError when caller is not the owner', async () => {
    const deps = makeDeps();
    (deps.db.query as MockedFunction<DbAdapter['query']>).mockResolvedValueOnce([
      { ...BASE_TICKET_ROW, owner_id: 'someone-else' },
    ] as unknown as DbRow[]);

    await expect(createOneClickListing(TICKET_ID, SELLER_ID, deps)).rejects.toThrow(TicketOwnershipError);
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('throws ResaleNotAllowedError when event.resale_allowed is false', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const dbQuery = deps.db.query as MockedFunction<DbAdapter['query']>;

    // Outer pre-flight succeeds (event loaded but resale_allowed=false doesn't fail outer);
    // inner createListing will then fail on resale_allowed check.
    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart, false)] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart, false)] as unknown as DbRow[]);

    await expect(createOneClickListing(TICKET_ID, SELLER_ID, deps)).rejects.toThrow(ResaleNotAllowedError);
  });

  it('throws TicketNotValidError when ticket status is not valid (e.g. used)', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const dbQuery = deps.db.query as MockedFunction<DbAdapter['query']>;

    // Outer pre-flight passes ownership check but inner createListing fails on status.
    dbQuery
      .mockResolvedValueOnce([{ ...BASE_TICKET_ROW, status: 'used' }] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[])
      .mockResolvedValueOnce([{ ...BASE_TICKET_ROW, status: 'used' }] as unknown as DbRow[]);

    await expect(createOneClickListing(TICKET_ID, SELLER_ID, deps)).rejects.toThrow(TicketNotValidError);
  });

  it('throws DuplicateListingError when an active listing already exists', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const dbQuery = deps.db.query as MockedFunction<DbAdapter['query']>;

    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[])
      .mockResolvedValueOnce([{ id: 'existing-listing' }] as unknown as DbRow[]);

    await expect(createOneClickListing(TICKET_ID, SELLER_ID, deps)).rejects.toThrow(DuplicateListingError);
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('throws EventTooSoonError when event starts within 24h and does NOT call inner createListing INSERT', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    const dbQuery = deps.db.query as MockedFunction<DbAdapter['query']>;

    dbQuery
      .mockResolvedValueOnce([BASE_TICKET_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([BASE_TICKET_TYPE_ROW] as unknown as DbRow[])
      .mockResolvedValueOnce([eventRow(dateStart)] as unknown as DbRow[]);

    await expect(createOneClickListing(TICKET_ID, SELLER_ID, deps)).rejects.toThrow(EventTooSoonError);
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('boundary: event 24h01min away succeeds with expiresAt ≈ now + 1min', async () => {
    const deps = makeDeps();
    const now = Date.now();
    const dateStart = new Date(now + 24 * 60 * 60 * 1000 + 60 * 1000); // 24h + 1min from now
    const expected = primeHappyPath(deps, dateStart);

    const listing = await createOneClickListing(TICKET_ID, SELLER_ID, deps);

    expect(listing.expiresAt).not.toBeNull();
    // expiresAt == dateStart - 24h == now + 1min (±ms)
    const diffMs = listing.expiresAt!.getTime() - now;
    expect(diffMs).toBeGreaterThan(0);
    expect(diffMs).toBeLessThanOrEqual(60 * 1000 + 100);
    expect(listing.expiresAt!.getTime()).toBe(expected.getTime());
  });
});

describe('ResaleListingService.createOneClickListing (method form)', () => {
  it('equivalent to the free function — smoke test', async () => {
    const deps = makeDeps();
    const dateStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    primeHappyPath(deps, dateStart);

    const service = new ResaleListingService(deps.db, deps.redis, deps.eventBus, deps.gopay, deps.push);
    const listing = await service.createOneClickListing(TICKET_ID, SELLER_ID);

    expect(listing.askPrice).toBe(ORIGINAL_PRICE_HALERE);
  });
});
