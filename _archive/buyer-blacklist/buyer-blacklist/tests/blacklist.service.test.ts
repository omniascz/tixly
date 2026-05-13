/**
 * Unit tests for the buyer-blacklist service layer.
 * All adapters are mocked — no real DB or Kafka calls.
 *
 * Run with: vitest run
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import {
  banUser,
  liftBan,
  checkBan,
  submitAppeal,
  reviewAppeal,
  listBans,
  listAppeals,
  type BlacklistDeps,
} from '../src/services/blacklist.service';
import type { DbAdapter, EventBusAdapter } from '../src/types/blacklist.types';
import {
  UserBannedError,
  AppealAlreadyExistsError,
  NotBannedError,
  InsufficientPrivilegesError,
  BlacklistEntryNotFoundError,
  AppealNotFoundError,
} from '../src/types/blacklist.types';

// ---------------------------------------------------------------------------
// Adapter mock factories
// ---------------------------------------------------------------------------

function makeDb(): DbAdapter {
  return {
    query: vi.fn(),
    transaction: vi.fn((fn: (db: DbAdapter) => Promise<unknown>) => fn(makeDb())),
  };
}

function makeEventBus(): EventBusAdapter {
  return { publish: vi.fn() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-uuid-001';
const PROMOTER_ID = 'promoter-uuid-002';
const USER_ID = 'buyer-uuid-003';
const EMAIL = 'buyer@example.com';
const ENTRY_ID = 'entry-uuid-abc';
const APPEAL_ID = 'appeal-uuid-xyz';

const BASE_ENTRY_ROW = {
  id: ENTRY_ID,
  user_id: USER_ID,
  email: EMAIL,
  promoter_id: null,
  scope: 'platform',
  reason: 'Fraudulent chargebacks',
  status: 'active',
  banned_by: ADMIN_ID,
  banned_at: new Date().toISOString(),
  lifted_at: null,
  lifted_by: null,
};

const BASE_PROMOTER_ENTRY_ROW = {
  ...BASE_ENTRY_ROW,
  id: 'entry-promoter-001',
  promoter_id: PROMOTER_ID,
  scope: 'promoter',
  banned_by: PROMOTER_ID,
  reason: 'Scalping',
};

const BASE_APPEAL_ROW = {
  id: APPEAL_ID,
  blacklist_entry_id: ENTRY_ID,
  user_id: USER_ID,
  message: 'I was incorrectly banned, please review.',
  created_at: new Date().toISOString(),
  reviewed_at: null,
  reviewed_by: null,
  decision: null,
};

// ---------------------------------------------------------------------------
// Helper: build deps with a transacting db whose inner query is mockable
// ---------------------------------------------------------------------------

function makeDepsWithQuery(queryFn: MockedFunction<DbAdapter['query']>): BlacklistDeps {
  const db: DbAdapter = {
    query: queryFn,
    transaction: vi.fn((fn: (db: DbAdapter) => Promise<unknown>) =>
      fn({ query: queryFn, transaction: vi.fn() }),
    ),
  };
  return { db, eventBus: makeEventBus() };
}

// ---------------------------------------------------------------------------
// banUser
// ---------------------------------------------------------------------------

describe('banUser', () => {
  it('creates a platform ban when caller is admin', async () => {
    const query = vi.fn().mockResolvedValue([BASE_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const entry = await banUser(
      deps,
      { userId: USER_ID, email: EMAIL, scope: 'platform', reason: 'Fraud', bannedBy: ADMIN_ID },
      'admin',
    );

    expect(entry.id).toBe(ENTRY_ID);
    expect(entry.scope).toBe('platform');
    expect(entry.status).toBe('active');
    expect(query).toHaveBeenCalledOnce();
  });

  it('creates a promoter ban when caller is promoter', async () => {
    const row = { ...BASE_PROMOTER_ENTRY_ROW };
    const query = vi.fn().mockResolvedValue([row]);
    const deps = makeDepsWithQuery(query);

    const entry = await banUser(
      deps,
      { userId: USER_ID, email: EMAIL, promoterId: PROMOTER_ID, scope: 'promoter', reason: 'Scalping', bannedBy: PROMOTER_ID },
      'promoter',
    );

    expect(entry.scope).toBe('promoter');
    expect(entry.promoterId).toBe(PROMOTER_ID);
  });

  it('throws InsufficientPrivilegesError when non-admin tries platform ban', async () => {
    const deps = makeDepsWithQuery(vi.fn());

    await expect(
      banUser(
        deps,
        { userId: USER_ID, email: EMAIL, scope: 'platform', reason: 'Fraud', bannedBy: PROMOTER_ID },
        'promoter',
      ),
    ).rejects.toThrow(InsufficientPrivilegesError);
  });

  it('throws InsufficientPrivilegesError when buyer tries any ban', async () => {
    const deps = makeDepsWithQuery(vi.fn());

    await expect(
      banUser(
        deps,
        { userId: USER_ID, email: EMAIL, scope: 'promoter', reason: 'Fraud', bannedBy: 'buyer-x' },
        'buyer',
      ),
    ).rejects.toThrow(InsufficientPrivilegesError);
  });

  it('publishes Kafka event after successful ban', async () => {
    const query = vi.fn().mockResolvedValue([BASE_ENTRY_ROW]);
    const eventBus = makeEventBus();
    const db: DbAdapter = {
      query,
      transaction: vi.fn((fn: (db: DbAdapter) => Promise<unknown>) =>
        fn({ query, transaction: vi.fn() }),
      ),
    };
    const deps: BlacklistDeps = { db, eventBus };

    await banUser(deps, { userId: USER_ID, email: EMAIL, scope: 'platform', reason: 'Test', bannedBy: ADMIN_ID }, 'admin');

    expect(eventBus.publish).toHaveBeenCalledWith(
      'tixly.blacklist.user-banned',
      expect.objectContaining({ entryId: ENTRY_ID, userId: USER_ID }),
    );
  });

  it('admin can also create promoter-scoped ban', async () => {
    const row = { ...BASE_PROMOTER_ENTRY_ROW };
    const query = vi.fn().mockResolvedValue([row]);
    const deps = makeDepsWithQuery(query);

    const entry = await banUser(
      deps,
      { userId: USER_ID, email: EMAIL, promoterId: PROMOTER_ID, scope: 'promoter', reason: 'Test', bannedBy: ADMIN_ID },
      'admin',
    );

    expect(entry.scope).toBe('promoter');
    expect(entry.promoterId).toBe(PROMOTER_ID);
  });
});

// ---------------------------------------------------------------------------
// liftBan
// ---------------------------------------------------------------------------

describe('liftBan', () => {
  it('lifts a platform ban when admin requests', async () => {
    const liftedRow = { ...BASE_ENTRY_ROW, status: 'lifted', lifted_at: new Date().toISOString(), lifted_by: ADMIN_ID };
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_ENTRY_ROW])     // SELECT
      .mockResolvedValueOnce([liftedRow]);           // UPDATE

    const eventBus = makeEventBus();
    const db: DbAdapter = {
      query,
      transaction: vi.fn((fn: (db: DbAdapter) => Promise<unknown>) =>
        fn({ query, transaction: vi.fn() }),
      ),
    };
    const deps: BlacklistDeps = { db, eventBus };

    const entry = await liftBan(deps, ENTRY_ID, ADMIN_ID, 'admin');

    expect(entry.status).toBe('lifted');
    expect(entry.liftedBy).toBe(ADMIN_ID);
    expect(eventBus.publish).toHaveBeenCalledWith(
      'tixly.blacklist.ban-lifted',
      expect.objectContaining({ entryId: ENTRY_ID }),
    );
  });

  it('throws InsufficientPrivilegesError when promoter tries to lift platform ban', async () => {
    const query = vi.fn().mockResolvedValueOnce([BASE_ENTRY_ROW]); // SELECT returns platform ban
    const deps = makeDepsWithQuery(query);

    await expect(liftBan(deps, ENTRY_ID, PROMOTER_ID, 'promoter')).rejects.toThrow(
      InsufficientPrivilegesError,
    );
  });

  it('throws BlacklistEntryNotFoundError when entry does not exist', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const deps = makeDepsWithQuery(query);

    await expect(liftBan(deps, 'nonexistent-id', ADMIN_ID, 'admin')).rejects.toThrow(
      BlacklistEntryNotFoundError,
    );
  });

  it('throws NotBannedError when entry is already lifted', async () => {
    const alreadyLifted = { ...BASE_ENTRY_ROW, status: 'lifted' };
    const query = vi.fn().mockResolvedValueOnce([alreadyLifted]);
    const deps = makeDepsWithQuery(query);

    await expect(liftBan(deps, ENTRY_ID, ADMIN_ID, 'admin')).rejects.toThrow(NotBannedError);
  });

  it('allows admin to lift a promoter-scoped ban', async () => {
    const liftedRow = { ...BASE_PROMOTER_ENTRY_ROW, status: 'lifted', lifted_at: new Date().toISOString(), lifted_by: ADMIN_ID };
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_PROMOTER_ENTRY_ROW])
      .mockResolvedValueOnce([liftedRow]);
    const deps = makeDepsWithQuery(query);

    const entry = await liftBan(deps, BASE_PROMOTER_ENTRY_ROW.id, ADMIN_ID, 'admin');
    expect(entry.status).toBe('lifted');
  });
});

// ---------------------------------------------------------------------------
// checkBan
// ---------------------------------------------------------------------------

describe('checkBan', () => {
  it('returns platform ban entry when user has platform ban', async () => {
    const query = vi.fn().mockResolvedValueOnce([BASE_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const result = await checkBan(deps, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('platform');
    expect(result?.userId).toBe(USER_ID);
  });

  it('returns null when user is not banned (anti-enumeration)', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const deps = makeDepsWithQuery(query);

    const result = await checkBan(deps, 'no-ban-user');

    expect(result).toBeNull();
  });

  it('returns promoter ban when no platform ban but promoter ban exists', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])                     // platform check → none
      .mockResolvedValueOnce([BASE_PROMOTER_ENTRY_ROW]); // promoter check → found

    const deps = makeDepsWithQuery(query);

    const result = await checkBan(deps, USER_ID, PROMOTER_ID);

    expect(result?.scope).toBe('promoter');
    expect(result?.promoterId).toBe(PROMOTER_ID);
  });

  it('returns null when promoterId not provided and only promoter ban exists', async () => {
    const query = vi.fn().mockResolvedValueOnce([]); // platform → none, no promoter check
    const deps = makeDepsWithQuery(query);

    const result = await checkBan(deps, USER_ID);

    expect(result).toBeNull();
  });

  it('platform ban takes precedence over promoter ban', async () => {
    // When platform ban exists, promoter query is never called
    const query = vi.fn().mockResolvedValueOnce([BASE_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const result = await checkBan(deps, USER_ID, PROMOTER_ID);

    expect(result?.scope).toBe('platform');
    // Second query (promoter) was never called
    expect(query).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// submitAppeal
// ---------------------------------------------------------------------------

describe('submitAppeal', () => {
  it('creates an appeal for a banned user', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_ENTRY_ROW])   // SELECT entry
      .mockResolvedValueOnce([BASE_APPEAL_ROW])  // INSERT appeal
      .mockResolvedValueOnce([]);                // UPDATE entry status

    const deps = makeDepsWithQuery(query);

    const appeal = await submitAppeal(deps, USER_ID, ENTRY_ID, 'Please reconsider.');

    expect(appeal.id).toBe(APPEAL_ID);
    expect(appeal.userId).toBe(USER_ID);
    expect(appeal.decision).toBeNull();
  });

  it('throws AppealAlreadyExistsError on ON CONFLICT (empty INSERT result)', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_ENTRY_ROW])  // SELECT entry
      .mockResolvedValueOnce([]);               // INSERT → ON CONFLICT DO NOTHING → empty

    const deps = makeDepsWithQuery(query);

    await expect(submitAppeal(deps, USER_ID, ENTRY_ID, 'Duplicate appeal')).rejects.toThrow(
      AppealAlreadyExistsError,
    );
  });

  it('throws BlacklistEntryNotFoundError when entry not found or belongs to different user', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const deps = makeDepsWithQuery(query);

    await expect(submitAppeal(deps, 'other-user', ENTRY_ID, 'I was not banned')).rejects.toThrow(
      BlacklistEntryNotFoundError,
    );
  });

  it('throws NotBannedError when ban is already lifted', async () => {
    const liftedEntry = { ...BASE_ENTRY_ROW, status: 'lifted' };
    const query = vi.fn().mockResolvedValueOnce([liftedEntry]);
    const deps = makeDepsWithQuery(query);

    await expect(submitAppeal(deps, USER_ID, ENTRY_ID, 'Late appeal')).rejects.toThrow(
      NotBannedError,
    );
  });
});

// ---------------------------------------------------------------------------
// reviewAppeal
// ---------------------------------------------------------------------------

describe('reviewAppeal', () => {
  it('rejects an appeal and sets ban back to active', async () => {
    const rejectedAppeal = { ...BASE_APPEAL_ROW, decision: 'rejected', reviewed_by: ADMIN_ID, reviewed_at: new Date().toISOString() };
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_APPEAL_ROW])   // SELECT appeal
      .mockResolvedValueOnce([rejectedAppeal])     // UPDATE appeal
      .mockResolvedValueOnce([]);                  // UPDATE entry status → active

    const deps = makeDepsWithQuery(query);

    const appeal = await reviewAppeal(deps, APPEAL_ID, 'rejected', ADMIN_ID, 'admin');

    expect(appeal.decision).toBe('rejected');
  });

  it('approves an appeal and lifts the ban', async () => {
    const approvedAppeal = {
      ...BASE_APPEAL_ROW,
      decision: 'approved',
      reviewed_by: ADMIN_ID,
      reviewed_at: new Date().toISOString(),
    };
    const liftedEntry = {
      ...BASE_ENTRY_ROW,
      status: 'lifted',
      lifted_at: new Date().toISOString(),
      lifted_by: ADMIN_ID,
    };

    // The query mock needs to serve:
    //  1. SELECT appeal
    //  2. UPDATE appeal (return approvedAppeal)
    //  3. SELECT entry (for liftBan)
    //  4. UPDATE entry (return liftedEntry)
    const query = vi.fn()
      .mockResolvedValueOnce([BASE_APPEAL_ROW])   // SELECT appeal
      .mockResolvedValueOnce([approvedAppeal])     // UPDATE appeal
      .mockResolvedValueOnce([BASE_ENTRY_ROW])     // liftBan SELECT
      .mockResolvedValueOnce([liftedEntry]);        // liftBan UPDATE

    const eventBus = makeEventBus();
    const db: DbAdapter = {
      query,
      transaction: vi.fn((fn: (db: DbAdapter) => Promise<unknown>) =>
        fn({ query, transaction: vi.fn() }),
      ),
    };
    const deps: BlacklistDeps = { db, eventBus };

    const appeal = await reviewAppeal(deps, APPEAL_ID, 'approved', ADMIN_ID, 'admin');

    expect(appeal.decision).toBe('approved');
    expect(eventBus.publish).toHaveBeenCalledWith(
      'tixly.blacklist.ban-lifted',
      expect.objectContaining({ entryId: ENTRY_ID }),
    );
  });

  it('is idempotent: returns existing review if already decided', async () => {
    const alreadyReviewed = { ...BASE_APPEAL_ROW, decision: 'rejected', reviewed_by: ADMIN_ID, reviewed_at: new Date().toISOString() };
    const query = vi.fn().mockResolvedValueOnce([alreadyReviewed]);
    const deps = makeDepsWithQuery(query);

    const appeal = await reviewAppeal(deps, APPEAL_ID, 'approved', ADMIN_ID, 'admin');

    // Should return current state without re-processing
    expect(appeal.decision).toBe('rejected');
    // Only SELECT was called
    expect(query).toHaveBeenCalledOnce();
  });

  it('throws AppealNotFoundError for unknown appeal', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const deps = makeDepsWithQuery(query);

    await expect(reviewAppeal(deps, 'bad-id', 'approved', ADMIN_ID, 'admin')).rejects.toThrow(
      AppealNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// listBans
// ---------------------------------------------------------------------------

describe('listBans', () => {
  it('returns all bans for admin role', async () => {
    const query = vi.fn().mockResolvedValue([BASE_ENTRY_ROW, BASE_PROMOTER_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const bans = await listBans(deps, 'admin');

    expect(bans).toHaveLength(2);
  });

  it('returns only promoter-scoped bans for promoter role', async () => {
    const query = vi.fn().mockResolvedValue([BASE_PROMOTER_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const bans = await listBans(deps, 'promoter', PROMOTER_ID);

    expect(bans).toHaveLength(1);
    expect(bans[0]?.scope).toBe('promoter');
    // Query must include promoter_id filter
    const callArg = (query.mock.calls[0] as unknown[])[0] as string;
    expect(callArg).toContain('promoter_id');
  });

  it('returns empty array when promoter has no promoterId set', async () => {
    const query = vi.fn();
    const deps = makeDepsWithQuery(query);

    const bans = await listBans(deps, 'promoter', undefined);

    expect(bans).toHaveLength(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('admin can filter bans by scope', async () => {
    const query = vi.fn().mockResolvedValue([BASE_ENTRY_ROW]);
    const deps = makeDepsWithQuery(query);

    const bans = await listBans(deps, 'admin', undefined, undefined, 'platform');

    expect(bans).toHaveLength(1);
    const callArg = (query.mock.calls[0] as unknown[])[0] as string;
    expect(callArg).toContain('scope');
  });
});

// ---------------------------------------------------------------------------
// listAppeals
// ---------------------------------------------------------------------------

describe('listAppeals', () => {
  it('returns all pending appeals for admin', async () => {
    const query = vi.fn().mockResolvedValue([BASE_APPEAL_ROW]);
    const deps = makeDepsWithQuery(query);

    const appeals = await listAppeals(deps, 'admin');

    expect(appeals).toHaveLength(1);
    expect(appeals[0]?.decision).toBeNull();
  });

  it('returns only own pending appeals for promoter', async () => {
    const query = vi.fn().mockResolvedValue([BASE_APPEAL_ROW]);
    const deps = makeDepsWithQuery(query);

    const appeals = await listAppeals(deps, 'promoter', PROMOTER_ID);

    expect(appeals).toHaveLength(1);
    const callArg = (query.mock.calls[0] as unknown[])[0] as string;
    expect(callArg).toContain('promoter_id');
  });

  it('returns empty array for promoter without promoterId', async () => {
    const query = vi.fn();
    const deps = makeDepsWithQuery(query);

    const appeals = await listAppeals(deps, 'promoter', undefined);

    expect(appeals).toHaveLength(0);
    expect(query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error class shape tests
// ---------------------------------------------------------------------------

describe('Error classes', () => {
  it('UserBannedError carries scope and reason fields', () => {
    const err = new UserBannedError('platform', 'Fraud');
    expect(err.scope).toBe('platform');
    expect(err.reason).toBe('Fraud');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('USER_BANNED');
  });

  it('AppealAlreadyExistsError has correct statusCode and code', () => {
    const err = new AppealAlreadyExistsError('entry-1');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('APPEAL_ALREADY_EXISTS');
  });

  it('NotBannedError has correct statusCode and code', () => {
    const err = new NotBannedError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_BANNED');
  });

  it('InsufficientPrivilegesError has correct statusCode', () => {
    const err = new InsufficientPrivilegesError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('INSUFFICIENT_PRIVILEGES');
  });

  it('BlacklistEntryNotFoundError includes entryId in message', () => {
    const err = new BlacklistEntryNotFoundError('my-entry');
    expect(err.message).toContain('my-entry');
    expect(err.statusCode).toBe(404);
  });

  it('AppealNotFoundError includes appealId in message', () => {
    const err = new AppealNotFoundError('my-appeal');
    expect(err.message).toContain('my-appeal');
    expect(err.statusCode).toBe(404);
  });
});
