/**
 * Feature #47 — Escrow hold + buyer flow tests
 *
 * Pokrývá:
 *   1. rotateTicketTotpSecret — generuje nový secret, zapisuje audit, FOR UPDATE
 *   2. handleGopayCallback (purchaseListing flow) — po platbě je escrow='held'
 *      a ticket má nový (jiný) secret
 *   3. releaseEscrowOnEntry — held → released, idempotence, no-op pro non-resale,
 *      správný payoutAmount
 *   4. Anti-replay: starý TOTP secret vyextrahovaný z audit logu se NEROVNÁ
 *      novému secretu v ticket row → starý QR by selhal verifyTOTP
 *
 * Všechny adaptery (db / kafka / gopay / push / encryptSecret) jsou mockovány —
 * žádné reálné side-effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rotateTicketTotpSecret,
  publishRotationEvent,
} from '../lib/totp-rotation.js';
import { releaseEscrowOnEntry } from '../lib/escrow-release.js';
import { ResaleListingService } from '../services/resale-listing.service.js';
import type {
  DbAdapter,
  EventBusAdapter,
  GopayAdapter,
  PushNotificationAdapter,
  RedisAdapter,
} from '../types/resale.js';

// ---------------------------------------------------------------------------
// Mock @tixly/crypto — deterministický a bez nutnosti TOTP_MASTER_KEY
// ---------------------------------------------------------------------------
vi.mock('@tixly/crypto', () => {
  let counter = 0;
  return {
    encryptSecret: vi.fn(async (secret: Buffer, ticketId: string) => {
      counter += 1;
      // Vrátíme deterministicky, ale unique per call: prefix + counter + secret
      return {
        encrypted: Buffer.concat([
          Buffer.from(`enc-${counter}-${ticketId}-`),
          secret,
        ]),
        iv: Buffer.from(`iv-${counter}-${ticketId}`.padEnd(12, '0').slice(0, 12)),
      };
    }),
    decryptSecret: vi.fn(async (enc: Buffer) => enc),
  };
});

// ---------------------------------------------------------------------------
// Helpers — mockový DbAdapter, který umí naplánovat odpovědi na sql query.
// ---------------------------------------------------------------------------

interface QueryStub {
  match: (sql: string) => boolean;
  rows: unknown[];
}

function makeDb(stubs: QueryStub[]): DbAdapter & { _calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const remaining = [...stubs];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const idx = remaining.findIndex((s) => s.match(sql));
    if (idx === -1) {
      // Default: prázdné rows pro UPDATE / INSERT bez RETURNING
      return [];
    }
    const stub = remaining.splice(idx, 1)[0];
    return stub.rows;
  });

  const db: DbAdapter & { _calls: typeof calls } = {
    query,
    transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      return fn({ query, transaction: vi.fn() } as unknown as DbAdapter);
    }),
    _calls: calls,
  } as unknown as DbAdapter & { _calls: typeof calls };

  return db;
}

function makeEventBus(): EventBusAdapter & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function makeGopay(): GopayAdapter {
  return {
    preauthorize: vi.fn(),
    capture: vi.fn(async () => undefined),
    voidAuthorization: vi.fn(),
    payout: vi.fn(),
    verifyHmacSignature: vi.fn(() => true),
  };
}

function makePush(): PushNotificationAdapter {
  return { send: vi.fn(async () => undefined) };
}

function makeRedis(): RedisAdapter {
  return { get: vi.fn(), set: vi.fn(), del: vi.fn() };
}

// ---------------------------------------------------------------------------
// 1. rotateTicketTotpSecret
// ---------------------------------------------------------------------------

describe('rotateTicketTotpSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('vygeneruje nový secret jiný než původní a zapíše audit log', async () => {
    const oldEnc = Buffer.from('old-encrypted-secret');
    const oldIv = Buffer.from('old-iv-12byte');

    const db = makeDb([
      // SELECT current ticket
      {
        match: (s) => /SELECT.*FROM tickets\.tickets[\s\S]*FOR UPDATE/i.test(s),
        rows: [
          {
            id: 'tkt-1',
            totp_secret_encrypted: oldEnc,
            totp_secret_iv: oldIv,
          },
        ],
      },
      // INSERT into ticket_transfer_log RETURNING id, transferred_at
      {
        match: (s) => /INSERT INTO tickets\.ticket_transfer_log/i.test(s),
        rows: [{ id: 'log-1', transferred_at: new Date().toISOString() }],
      },
    ]);

    const result = await rotateTicketTotpSecret(
      'tkt-1',
      'resale_purchase',
      'buyer-1',
      db,
      'listing-1',
    );

    expect(result.transferLogId).toBe('log-1');
    expect(result.rotatedAt).toBeInstanceOf(Date);
    // Nový (zašifrovaný) secret nesmí být shodný se starým
    expect(result.newEncrypted.equals(oldEnc)).toBe(false);

    // Ověř, že proběhly UPDATE tickets a INSERT do audit logu
    const updateCall = db._calls.find((c) => /UPDATE tickets\.tickets/i.test(c.sql));
    expect(updateCall).toBeDefined();
    // params: [newEnc, newIv, ticketId]
    expect(updateCall!.params[2]).toBe('tkt-1');

    const insertCall = db._calls.find((c) =>
      /INSERT INTO tickets\.ticket_transfer_log/i.test(c.sql),
    );
    expect(insertCall).toBeDefined();
    // params: [listingId, ticketId, oldEnc, oldIv, newEnc, newIv, reason, actor]
    expect(insertCall!.params[0]).toBe('listing-1');
    expect(insertCall!.params[1]).toBe('tkt-1');
    expect(insertCall!.params[2]).toBe(oldEnc);
    expect(insertCall!.params[6]).toBe('resale_purchase');
    expect(insertCall!.params[7]).toBe('buyer-1');
    // new_encrypted MUSÍ být jiný buffer než old
    expect((insertCall!.params[4] as Buffer).equals(oldEnc)).toBe(false);
  });

  it('vyhodí TotpRotationFailedError pokud vstupenka neexistuje', async () => {
    const db = makeDb([
      {
        match: (s) => /SELECT.*FROM tickets\.tickets/i.test(s),
        rows: [], // not found
      },
    ]);

    await expect(
      rotateTicketTotpSecret('missing', 'resale_purchase', 'b', db),
    ).rejects.toThrow(/nenalezena/);
  });

  it('publishRotationEvent emituje ticket.totp_rotated', async () => {
    const bus = makeEventBus();
    const at = new Date('2026-04-08T12:00:00Z');
    await publishRotationEvent(bus, 'tkt-9', at, 'resale_purchase');

    expect(bus.publish).toHaveBeenCalledWith('ticket.totp_rotated', {
      ticketId: 'tkt-9',
      rotatedAt: at.toISOString(),
      reason: 'resale_purchase',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. handleGopayCallback (purchase flow integration)
// ---------------------------------------------------------------------------

describe('handleGopayCallback → AUTHORIZED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('po AUTHORIZED je escrow=held (NE released) a ticket má nový secret', async () => {
    const oldEnc = Buffer.from('seller-original-secret');
    const oldIv = Buffer.from('iv-original0');

    const listingRow = {
      id: 'listing-1',
      ticket_id: 'tkt-1',
      seller_id: 'seller-1',
      buyer_id: 'buyer-1',
      ask_price: '5000',
      original_price: '5000',
      commission_rate: '0.05',
      status: 'reserved',
      escrow_status: 'none',
      escrow_gopay_id: 'gopay-xyz',
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

    const db = makeDb([
      // 1. SELECT listing by escrow_gopay_id
      {
        match: (s) => /SELECT.*FROM resale\.resale_listings WHERE escrow_gopay_id/i.test(s),
        rows: [listingRow],
      },
      // 2. SELECT ticket FOR UPDATE (uvnitř rotateTicketTotpSecret)
      {
        match: (s) => /SELECT.*FROM tickets\.tickets[\s\S]*FOR UPDATE/i.test(s),
        rows: [
          {
            id: 'tkt-1',
            totp_secret_encrypted: oldEnc,
            totp_secret_iv: oldIv,
          },
        ],
      },
      // 3. INSERT do transfer logu RETURNING
      {
        match: (s) => /INSERT INTO tickets\.ticket_transfer_log/i.test(s),
        rows: [{ id: 'log-1', transferred_at: new Date().toISOString() }],
      },
    ]);

    const bus = makeEventBus();
    const service = new ResaleListingService(
      db,
      makeRedis(),
      bus,
      makeGopay(),
      makePush(),
    );

    await service.handleGopayCallback('gopay-xyz', 'AUTHORIZED');

    // Najdi UPDATE listing -- escrow_status musí být 'held', NIKDY 'released'
    const listingUpdate = db._calls.find((c) =>
      /UPDATE resale\.resale_listings[\s\S]*escrow_status = 'held'/i.test(c.sql),
    );
    expect(listingUpdate).toBeDefined();

    // A nesmí existovat žádný UPDATE, který by escrow nastavil na 'released'
    const releasedUpdate = db._calls.find((c) =>
      /escrow_status = 'released'/i.test(c.sql),
    );
    expect(releasedUpdate).toBeUndefined();

    // Owner_id se přepsal na buyer
    const ownerUpdate = db._calls.find((c) =>
      /UPDATE tickets\.tickets[\s\S]*owner_id/i.test(c.sql),
    );
    expect(ownerUpdate).toBeDefined();
    expect(ownerUpdate!.params[0]).toBe('buyer-1');

    // Anti-replay: nový encrypted secret v UPDATE tickets je JINÝ než old
    const ticketSecretUpdate = db._calls.find((c) =>
      /UPDATE tickets\.tickets[\s\S]*totp_secret_encrypted/i.test(c.sql),
    );
    expect(ticketSecretUpdate).toBeDefined();
    expect((ticketSecretUpdate!.params[0] as Buffer).equals(oldEnc)).toBe(false);

    // Kafka: ticket.totp_rotated
    expect(bus.publish).toHaveBeenCalledWith(
      'ticket.totp_rotated',
      expect.objectContaining({ ticketId: 'tkt-1', reason: 'resale_purchase' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. releaseEscrowOnEntry
// ---------------------------------------------------------------------------

describe('releaseEscrowOnEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uvolní held escrow a vrátí správný payoutAmount (askPrice − commission)', async () => {
    const db = makeDb([
      {
        match: (s) => /SELECT.*FROM resale\.resale_listings[\s\S]*FOR UPDATE/i.test(s),
        rows: [
          {
            id: 'listing-1',
            seller_id: 'seller-1',
            buyer_id: 'buyer-1',
            ask_price: '10000', // 100 Kč v haléřích
            commission_rate: '0.05',
            escrow_gopay_id: 'gopay-xyz',
            escrow_status: 'held',
          },
        ],
      },
    ]);

    const bus = makeEventBus();
    const result = await releaseEscrowOnEntry('tkt-1', {
      db,
      eventBus: bus,
      gopay: makeGopay(),
    });

    expect(result.released).toBe(true);
    // 10000 − round(10000 * 0.05) = 10000 − 500 = 9500
    expect(result.payoutAmount).toBe(9500);
    expect(result.listingId).toBe('listing-1');

    // Ověř UPDATE escrow → released
    const update = db._calls.find((c) =>
      /UPDATE resale\.resale_listings[\s\S]*escrow_status = 'released'/i.test(c.sql),
    );
    expect(update).toBeDefined();
    expect(update!.params[0]).toBe(9500);

    // Kafka event
    expect(bus.publish).toHaveBeenCalledWith(
      'escrow.released',
      expect.objectContaining({
        listingId: 'listing-1',
        payoutAmount: 9500,
        trigger: 'venue_entry',
      }),
    );
  });

  it('je idempotentní — opakované volání pro již released listing je no-op', async () => {
    const db = makeDb([
      {
        match: (s) => /SELECT.*FROM resale\.resale_listings[\s\S]*FOR UPDATE/i.test(s),
        rows: [
          {
            id: 'listing-1',
            seller_id: 'seller-1',
            buyer_id: 'buyer-1',
            ask_price: '10000',
            commission_rate: '0.05',
            escrow_gopay_id: 'gopay-xyz',
            escrow_status: 'released', // už uvolněno
          },
        ],
      },
    ]);

    const bus = makeEventBus();
    const result = await releaseEscrowOnEntry('tkt-1', { db, eventBus: bus });

    expect(result.released).toBe(false);
    expect(result.payoutAmount).toBeNull();
    expect(result.listingId).toBe('listing-1');

    // Žádný UPDATE se nevolal
    const update = db._calls.find((c) => /UPDATE resale\.resale_listings/i.test(c.sql));
    expect(update).toBeUndefined();
    // Žádný event
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('je no-op pro non-resale vstupenku (žádný listing)', async () => {
    const db = makeDb([
      {
        match: (s) => /SELECT.*FROM resale\.resale_listings/i.test(s),
        rows: [],
      },
    ]);

    const bus = makeEventBus();
    const result = await releaseEscrowOnEntry('tkt-not-resale', {
      db,
      eventBus: bus,
    });

    expect(result.released).toBe(false);
    expect(result.payoutAmount).toBeNull();
    expect(result.listingId).toBeNull();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Anti-replay: starý secret z audit logu ≠ aktuální secret v ticketu
// ---------------------------------------------------------------------------

describe('Anti-replay invariant', () => {
  it('po rotaci je old secret v audit logu ODLIŠNÝ od new secret v tickets', async () => {
    const oldEnc = Buffer.from('OLD-secret-bytes');
    const oldIv = Buffer.from('old-iv-12bts');

    let capturedNewEnc: Buffer | null = null;
    let capturedAuditOldEnc: Buffer | null = null;
    let capturedAuditNewEnc: Buffer | null = null;

    const db: DbAdapter = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (/SELECT.*FROM tickets\.tickets[\s\S]*FOR UPDATE/i.test(sql)) {
          return [
            {
              id: 'tkt-x',
              totp_secret_encrypted: oldEnc,
              totp_secret_iv: oldIv,
            },
          ];
        }
        if (/UPDATE tickets\.tickets/i.test(sql)) {
          capturedNewEnc = params[0] as Buffer;
          return [];
        }
        if (/INSERT INTO tickets\.ticket_transfer_log/i.test(sql)) {
          capturedAuditOldEnc = params[2] as Buffer;
          capturedAuditNewEnc = params[4] as Buffer;
          return [{ id: 'log-x', transferred_at: new Date().toISOString() }];
        }
        return [];
      }),
      transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(db)),
    } as unknown as DbAdapter;

    await rotateTicketTotpSecret('tkt-x', 'resale_purchase', 'buyer-x', db);

    // Audit log obsahuje starý secret přesně jak byl
    expect(capturedAuditOldEnc!.equals(oldEnc)).toBe(true);
    // Nový secret zapsaný do tickets je jiný než starý
    expect(capturedNewEnc!.equals(oldEnc)).toBe(false);
    // Audit "new" sloupec drží stejnou hodnotu jako ta v ticket UPDATE
    expect(capturedAuditNewEnc!.equals(capturedNewEnc!)).toBe(true);
    // Tj. jakýkoli TOTP kód odvozený ze "starého" secretu vedl by k jinému
    // HMAC než ten odvozený z "nového" secretu, který nyní leží v ticketu —
    // verifyTOTP by selhalo, což je očekávaný anti-replay invariant.
  });
});
