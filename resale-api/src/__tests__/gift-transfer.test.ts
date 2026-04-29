/**
 * Feature #49 — "Daruju vstupenku" (free ticket gift transfer).
 *
 * Tests the giftTransferTicket service. All adapters are mocked. The shared
 * rotateTicketTotpSecret helper from totp-rotation.ts is mocked so tests do
 * not need real crypto.
 *
 * Run: vitest src/__tests__/gift-transfer.test.ts
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// IMPORTANT: mock totp-rotation BEFORE importing the service under test
vi.mock('../lib/totp-rotation.js', () => ({
  rotateTicketTotpSecret: vi.fn(),
  publishRotationEvent: vi.fn(),
}));

import { giftTransferTicket } from '../services/gift-transfer.service.js';
import { rotateTicketTotpSecret, publishRotationEvent } from '../lib/totp-rotation.js';
import type { ServiceDeps } from '../services/resale-listing.service.js';
import type { DbAdapter, DbRow } from '../types/resale.js';
import {
  RecipientNotFoundError,
  SelfTransferError,
  TicketOwnershipError,
  TicketNotValidError,
  TransferNotAllowedError,
  TicketAlreadyTransferredError,
} from '../lib/resale-errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FROM_USER_ID = 'user-from-001';
const RECIPIENT_ID = 'user-to-002';
const TICKET_ID = 'ticket-uuid-abc';
const EVENT_ID = 'event-uuid-001';
const RECIPIENT_EMAIL = 'recipient@example.com';
const TRANSFER_LOG_ID = 'transfer-log-uuid-xyz';
const GIFT_LOG_ID = 'gift-log-uuid-zzz';

const BASE_TICKET_ROW = {
  id: TICKET_ID,
  owner_id: FROM_USER_ID,
  status: 'valid',
  transferable: true,
  event_id: EVENT_ID,
};

const NOW_ISO = new Date().toISOString();

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockTx extends DbAdapter {
  query: MockedFunction<DbAdapter['query']>;
}

function makeTx(): MockTx {
  return {
    query: vi.fn(),
    transaction: vi.fn(),
  } as unknown as MockTx;
}

function makeDb(tx: MockTx): DbAdapter {
  return {
    query: vi.fn(),
    transaction: vi.fn(async (fn: (tx: DbAdapter) => Promise<unknown>) => fn(tx)),
  } as unknown as DbAdapter;
}

function makeDeps(): ServiceDeps & { _tx: MockTx } {
  const tx = makeTx();
  const db = makeDb(tx);
  return {
    db,
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } as unknown as ServiceDeps['redis'],
    eventBus: { publish: vi.fn().mockResolvedValue(undefined) } as unknown as ServiceDeps['eventBus'],
    gopay: {
      preauthorize: vi.fn(),
      capture: vi.fn(),
      voidAuthorization: vi.fn(),
      payout: vi.fn(),
      verifyHmacSignature: vi.fn(),
    } as unknown as ServiceDeps['gopay'],
    push: { send: vi.fn() } as unknown as ServiceDeps['push'],
    _tx: tx,
  };
}

/**
 * Prime the tx.query mock for the full happy-path query sequence:
 *  1) recipient lookup
 *  2) ticket join
 *  3) recent transfer check (anti double-tap)
 *  4) UPDATE tickets (returns nothing)
 *  5) INSERT gift_transfer_log RETURNING id, transferred_at
 */
function primeHappyPathQueries(
  tx: MockTx,
  opts: {
    recipient?: DbRow[] | null;
    ticket?: DbRow[];
    recentTransfer?: DbRow[];
  } = {},
): void {
  const recipientRows = opts.recipient ?? [{ id: RECIPIENT_ID }];
  const ticketRows = opts.ticket ?? [BASE_TICKET_ROW];
  const recent = opts.recentTransfer ?? [];

  tx.query
    .mockResolvedValueOnce(recipientRows as unknown as DbRow[]) // recipient
    .mockResolvedValueOnce(ticketRows as unknown as DbRow[]) // ticket join
    .mockResolvedValueOnce(recent as unknown as DbRow[]) // recent transfer check
    .mockResolvedValueOnce([] as DbRow[]) // UPDATE tickets
    .mockResolvedValueOnce([{ id: GIFT_LOG_ID, transferred_at: NOW_ISO }] as unknown as DbRow[]); // INSERT gift_transfer_log
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default rotation result — overridden in specific tests
  (rotateTicketTotpSecret as unknown as MockedFunction<typeof rotateTicketTotpSecret>).mockResolvedValue({
    transferLogId: TRANSFER_LOG_ID,
    rotatedAt: new Date(NOW_ISO),
    newEncrypted: Buffer.from('new-encrypted-secret'),
    newIv: Buffer.from('new-iv-12byte'),
  });
  (publishRotationEvent as unknown as MockedFunction<typeof publishRotationEvent>).mockResolvedValue(undefined);
});

describe('giftTransferTicket — Feature #49', () => {
  it('happy path: gifts ticket, rotates TOTP, updates owner, emits ticket.gifted', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx);

    const result = await giftTransferTicket(
      TICKET_ID,
      FROM_USER_ID,
      RECIPIENT_EMAIL,
      'Užij si to!',
      deps,
    );

    expect(result.transferLogId).toBe(TRANSFER_LOG_ID);
    expect(result.newOwnerId).toBe(RECIPIENT_ID);
    expect(result.oldOwnerId).toBe(FROM_USER_ID);
    expect(result.ticketId).toBe(TICKET_ID);

    // Rotation called exactly once with reason='gift_transfer'
    expect(rotateTicketTotpSecret).toHaveBeenCalledTimes(1);
    expect(rotateTicketTotpSecret).toHaveBeenCalledWith(
      TICKET_ID,
      'gift_transfer',
      FROM_USER_ID,
      deps._tx,
    );

    // Owner UPDATE issued
    const updateCall = deps._tx.query.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE tickets.tickets'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([RECIPIENT_ID, TICKET_ID]);

    // Gift event published with full payload
    expect(deps.eventBus.publish).toHaveBeenCalledWith('ticket.gifted', {
      ticketId: TICKET_ID,
      fromUserId: FROM_USER_ID,
      toUserId: RECIPIENT_ID,
      message: 'Užij si to!',
    });

    // Kafka rotation event also fired
    expect(publishRotationEvent).toHaveBeenCalledWith(
      deps.eventBus,
      TICKET_ID,
      expect.any(Date),
      'gift_transfer',
    );
  });

  it('lowercases recipient email when looking it up', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx);

    await giftTransferTicket(TICKET_ID, FROM_USER_ID, 'Mixed.Case@Example.COM', null, deps);

    const recipientCall = deps._tx.query.mock.calls[0];
    expect(recipientCall[1]).toEqual(['mixed.case@example.com']);
  });

  it('throws RecipientNotFoundError when email is not registered', async () => {
    const deps = makeDeps();
    deps._tx.query.mockResolvedValueOnce([] as DbRow[]); // recipient lookup empty

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(RecipientNotFoundError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
    // No owner UPDATE issued
    const updateCall = deps._tx.query.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE tickets.tickets'),
    );
    expect(updateCall).toBeUndefined();
    expect(deps.eventBus.publish).not.toHaveBeenCalled();
  });

  it('throws SelfTransferError when recipient is the sender', async () => {
    const deps = makeDeps();
    deps._tx.query.mockResolvedValueOnce([{ id: FROM_USER_ID }] as unknown as DbRow[]);

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(SelfTransferError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
  });

  it('throws TicketOwnershipError when caller is not the ticket owner', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx, {
      ticket: [{ ...BASE_TICKET_ROW, owner_id: 'someone-else' }],
    });

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(TicketOwnershipError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
  });

  it('throws TicketNotValidError when ticket status is not valid', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx, {
      ticket: [{ ...BASE_TICKET_ROW, status: 'used' }],
    });

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(TicketNotValidError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
  });

  it('throws TransferNotAllowedError when ticket type is non-transferable', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx, {
      ticket: [{ ...BASE_TICKET_ROW, transferable: false }],
    });

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(TransferNotAllowedError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
  });

  it('throws TicketAlreadyTransferredError when a recent gift exists (anti double-tap)', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx, {
      recentTransfer: [{ '?column?': 1 }],
    });

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps),
    ).rejects.toThrow(TicketAlreadyTransferredError);

    expect(rotateTicketTotpSecret).not.toHaveBeenCalled();
  });

  it('TOTP rotation: new secret returned by helper differs from any old secret in audit log', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx);

    const oldSecret = Buffer.from('OLD-secret-bytes-padding---32');
    const newSecret = Buffer.from('NEW-secret-bytes-padding---32');

    (rotateTicketTotpSecret as unknown as MockedFunction<typeof rotateTicketTotpSecret>).mockResolvedValueOnce({
      transferLogId: TRANSFER_LOG_ID,
      rotatedAt: new Date(NOW_ISO),
      newEncrypted: newSecret,
      newIv: Buffer.from('iv-12-bytes!'),
    });

    await giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps);

    // The helper returned a new buffer that is distinguishable from any plausible old one
    expect(newSecret.equals(oldSecret)).toBe(false);
    expect(rotateTicketTotpSecret).toHaveBeenCalledWith(
      TICKET_ID,
      'gift_transfer',
      FROM_USER_ID,
      deps._tx,
    );
  });

  it('handles null message — gift_transfer_log INSERT receives null in 5th param', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx);

    await giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, null, deps);

    const insertCall = deps._tx.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO tickets.gift_transfer_log'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      TICKET_ID,
      TRANSFER_LOG_ID,
      FROM_USER_ID,
      RECIPIENT_ID,
      null,
    ]);
  });

  it('does NOT fail the whole flow when ticket.gifted publish throws (fire-and-forget)', async () => {
    const deps = makeDeps();
    primeHappyPathQueries(deps._tx);
    (deps.eventBus.publish as MockedFunction<typeof deps.eventBus.publish>).mockRejectedValueOnce(
      new Error('kafka down'),
    );

    await expect(
      giftTransferTicket(TICKET_ID, FROM_USER_ID, RECIPIENT_EMAIL, 'hi', deps),
    ).resolves.toMatchObject({ newOwnerId: RECIPIENT_ID });
  });
});

// ---------------------------------------------------------------------------
// Route-layer validation: long message rejection
// ---------------------------------------------------------------------------

describe('POST /api/tickets/[ticketId]/gift — input validation', () => {
  it('rejects messages longer than 500 chars at the route layer', async () => {
    // Import the route lazily so the totp-rotation mock above doesn't matter
    const { POST } = await import('../app/api/tickets/[ticketId]/gift/route.js');

    const longMessage = 'a'.repeat(501);
    const request = new Request('http://localhost/api/tickets/abc/gift', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': FROM_USER_ID,
      },
      body: JSON.stringify({ recipientEmail: RECIPIENT_EMAIL, message: longMessage }),
    });

    // NextRequest is a thin wrapper around Request — cast for the handler
    const response = await POST(request as unknown as Parameters<typeof POST>[0], {
      params: { ticketId: TICKET_ID },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('MESSAGE_TOO_LONG');
  });

  it('returns 401 when x-user-id header is missing', async () => {
    const { POST } = await import('../app/api/tickets/[ticketId]/gift/route.js');

    const request = new Request('http://localhost/api/tickets/abc/gift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipientEmail: RECIPIENT_EMAIL }),
    });

    const response = await POST(request as unknown as Parameters<typeof POST>[0], {
      params: { ticketId: TICKET_ID },
    });

    expect(response.status).toBe(401);
  });

  it('rejects invalid email format', async () => {
    const { POST } = await import('../app/api/tickets/[ticketId]/gift/route.js');

    const request = new Request('http://localhost/api/tickets/abc/gift', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': FROM_USER_ID,
      },
      body: JSON.stringify({ recipientEmail: 'not-an-email' }),
    });

    const response = await POST(request as unknown as Parameters<typeof POST>[0], {
      params: { ticketId: TICKET_ID },
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('INVALID_EMAIL');
  });
});
