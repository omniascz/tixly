import { describe, it, expect, vi } from 'vitest';
import {
  createFriendInvite,
  getInviteByToken,
  acceptFriendInvite,
  declineFriendInvite,
} from '../services/friend-invite.service.js';
import type { DbAdapter } from '../services/friend-invite.service.js';

const EVENT_ID = 'event-001';
const BUYER_ID = 'buyer-001';
const INVITEE_EMAIL = 'friend@example.com';
const INVITE_ID = 'invite-001';
const INVITE_TOKEN = 'abc123def456';

function makeInviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE_ID,
    event_id: EVENT_ID,
    buyer_id: BUYER_ID,
    invite_token: INVITE_TOKEN,
    invitee_email: INVITEE_EMAIL,
    seat_hold_qty: 3,
    status: 'pending',
    expires_at: '2026-04-21T10:00:00Z',
    accepted_at: null,
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createFriendInvite', () => {
  it('vytvoří pozvánku s 7 dny expirace', async () => {
    const db = makeDb([[makeInviteRow()]]);

    const result = await createFriendInvite(EVENT_ID, BUYER_ID, {
      inviteeEmail: INVITEE_EMAIL,
      seatHoldQty: 3,
    }, db);

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.seatHoldQty).toBe(3);
    expect(result.status).toBe('pending');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('INTERVAL');
    expect(sql).toContain('7 days');
  });

  it('vyhodí VALIDATION_ERROR pro seatHoldQty > 10', async () => {
    const db = makeDb([]);

    await expect(
      createFriendInvite(EVENT_ID, BUYER_ID, {
        inviteeEmail: INVITEE_EMAIL,
        seatHoldQty: 11,
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getInviteByToken', () => {
  it('vrátí pozvánku dle invite_token', async () => {
    const db = makeDb([[makeInviteRow()]]);

    const result = await getInviteByToken(INVITE_TOKEN, db);

    expect(result?.inviteToken).toBe(INVITE_TOKEN);
    expect(result?.inviteeEmail).toBe(INVITEE_EMAIL);
  });

  it('vrátí null pokud token neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getInviteByToken('invalid-token', db);

    expect(result).toBeNull();
  });
});

describe('acceptFriendInvite', () => {
  it('změni status na accepted a vrátí row', async () => {
    const db = makeDb([[makeInviteRow({ status: 'accepted', accepted_at: '2026-04-14T11:00:00Z' })]]);

    const result = await acceptFriendInvite(INVITE_ID, INVITE_TOKEN, 'invitee-123', db);

    expect(result.status).toBe('accepted');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('expires_at > NOW()');
  });

  it('vyhodí NOT_FOUND pokud pozvánka neexistuje, expirovala nebo byla zodpovězena', async () => {
    const db = makeDb([[]]);

    await expect(
      acceptFriendInvite(INVITE_ID, INVITE_TOKEN, 'invitee-123', db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('declineFriendInvite', () => {
  it('změni status na declined', async () => {
    const db = makeDb([[makeInviteRow({ status: 'declined' })]]);

    const result = await declineFriendInvite(INVITE_ID, INVITE_TOKEN, db);

    expect(result.status).toBe('declined');
  });
});
