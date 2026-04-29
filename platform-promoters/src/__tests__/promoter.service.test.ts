import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPromoter,
  updatePromoter,
  submitKyc,
  approveKyc,
  rejectKyc,
  suspendPromoter,
  activatePromoter,
  banPromoter,
  addMember,
  removeMember,
  assertMemberAccess,
} from '../services/promoter.service.js';
import { PlatformError } from '../lib/platform-errors.js';
import type { ServiceDeps, DbAdapter, KafkaProducerAdapter } from '../lib/service-container.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-05T10:00:00.000Z');

function makePromoterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promoter-uuid-1',
    name: 'Rock Festival Praha',
    legal_name: null,
    ico: null,
    dic: null,
    email: 'info@rockfest.cz',
    phone: null,
    website: null,
    logo_url: null,
    brand_colors: {},
    slug: 'rock-festival-praha',
    status: 'pending',
    kyc_status: 'not_started',
    kyc_verified_at: null,
    kyc_notes: null,
    bank_account_iban: null,
    bank_account_swift: null,
    stripe_account_id: null,
    default_currency: 'CZK',
    timezone: 'Europe/Prague',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-uuid-1',
    promoter_id: 'promoter-uuid-1',
    user_id: 'user-uuid-1',
    role: 'owner',
    status: 'active',
    invited_at: NOW,
    activated_at: NOW,
    ...overrides,
  };
}

/**
 * Creates a mock DbAdapter where `query` returns different data based on call order.
 * `responses` is an array of return values for successive calls.
 */
function makeDb(responses: unknown[][] = [[]]): DbAdapter {
  let callCount = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const result = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      return Promise.resolve(result);
    }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  };
}

function makeKafka(): KafkaProducerAdapter {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(db: DbAdapter, kafka: KafkaProducerAdapter): ServiceDeps {
  return { db, kafka };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createPromoter', () => {
  it('creates promoter with status=pending and kyc_status=not_started', async () => {
    const db = makeDb([
      [],                    // generateUniqueSlug LIKE query — no conflicts
      [makePromoterRow()],   // INSERT promoter RETURNING *
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    const result = await createPromoter(
      { name: 'Rock Festival Praha', email: 'info@rockfest.cz' },
      'user-uuid-1',
      deps,
    );

    expect(result.status).toBe('pending');
    expect(result.kycStatus).toBe('not_started');
    expect(result.name).toBe('Rock Festival Praha');
  });

  it('creates a PromoterMember with role=owner for the registering user', async () => {
    const db = makeDb([
      [],                    // slug query
      [makePromoterRow()],   // INSERT promoter
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await createPromoter(
      { name: 'Rock Festival Praha', email: 'info@rockfest.cz' },
      'user-uuid-1',
      deps,
    );

    // db.execute should be called for INSERT INTO promoter_members
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform.promoter_members'),
      expect.arrayContaining(['promoter-uuid-1', 'user-uuid-1']),
    );
  });

  it('generates slug from name', async () => {
    const db = makeDb([
      [],
      [makePromoterRow({ slug: 'rock-festival-praha' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    const result = await createPromoter(
      { name: 'Rock Festival Praha', email: 'info@rockfest.cz' },
      'user-uuid-1',
      deps,
    );

    expect(result.slug).toBe('rock-festival-praha');
  });

  it('handles slug conflict by appending -2', async () => {
    const db = makeDb([
      [{ slug: 'rock-festival-praha' }],  // slug LIKE query — conflict exists
      [makePromoterRow({ slug: 'rock-festival-praha-2' })],  // INSERT
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    const result = await createPromoter(
      { name: 'Rock Festival Praha', email: 'info@rockfest.cz' },
      'user-uuid-1',
      deps,
    );

    // slug should be -2 variant
    expect(result.slug).toBe('rock-festival-praha-2');
  });

  it('emits Kafka "promoter.registered" event', async () => {
    const db = makeDb([
      [],
      [makePromoterRow()],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await createPromoter(
      { name: 'Rock Festival Praha', email: 'info@rockfest.cz' },
      'user-uuid-1',
      deps,
    );

    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.registered',
      expect.objectContaining({
        promoterId: 'promoter-uuid-1',
        userId: 'user-uuid-1',
        name: 'Rock Festival Praha',
      }),
    );
  });
});

describe('submitKyc', () => {
  it('transitions kyc_status from not_started to submitted', async () => {
    const ownerMemberRow = makeMemberRow();
    const promoterRow = makePromoterRow({ kyc_status: 'not_started' });

    const db = makeDb([
      [ownerMemberRow],   // assertMemberAccess
      [promoterRow],      // getPromoterById
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await submitKyc('promoter-uuid-1', 'user-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("kyc_status = 'submitted'"),
      ['promoter-uuid-1'],
    );
  });

  it('emits Kafka "promoter.kyc.submitted" event', async () => {
    const db = makeDb([
      [makeMemberRow()],
      [makePromoterRow({ kyc_status: 'not_started' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await submitKyc('promoter-uuid-1', 'user-uuid-1', deps);

    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.kyc.submitted',
      expect.objectContaining({ promoterId: 'promoter-uuid-1' }),
    );
  });
});

describe('approveKyc', () => {
  it('transitions kyc_status to verified and status pending → active', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'submitted', status: 'pending' })],  // getPromoterById
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await approveKyc('promoter-uuid-1', 'admin-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("kyc_status = 'verified'"),
      expect.arrayContaining(['active', 'promoter-uuid-1']),
    );
  });

  it('inserts admin_actions record on KYC approve', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'submitted', status: 'pending' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await approveKyc('promoter-uuid-1', 'admin-uuid-1', deps);

    // execute is called twice: UPDATE promoters + INSERT admin_actions (2nd call)
    expect(db.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO platform.admin_actions'),
      expect.arrayContaining(['admin-uuid-1', 'promoter-uuid-1']),
    );
  });

  it('emits promoter.kyc.approved and promoter.activated Kafka events', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'submitted', status: 'pending' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await approveKyc('promoter-uuid-1', 'admin-uuid-1', deps);

    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.kyc.approved',
      expect.objectContaining({ promoterId: 'promoter-uuid-1', adminUserId: 'admin-uuid-1' }),
    );
    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.activated',
      expect.objectContaining({ promoterId: 'promoter-uuid-1' }),
    );
  });

  it('throws INVALID_STATUS_TRANSITION when kyc_status is not submitted', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'not_started' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(approveKyc('promoter-uuid-1', 'admin-uuid-1', deps)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }),
    );
  });
});

describe('rejectKyc', () => {
  it('transitions kyc_status submitted → rejected and stores notes', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'submitted' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await rejectKyc('promoter-uuid-1', 'Missing documents', 'admin-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("kyc_status = 'rejected'"),
      expect.arrayContaining(['Missing documents', 'promoter-uuid-1']),
    );
  });

  it('inserts admin_actions record on KYC reject', async () => {
    const db = makeDb([
      [makePromoterRow({ kyc_status: 'submitted' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await rejectKyc('promoter-uuid-1', 'Missing documents', 'admin-uuid-1', deps);

    // execute is called twice: UPDATE promoters + INSERT admin_actions (2nd call)
    expect(db.execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO platform.admin_actions'),
      expect.arrayContaining(['admin-uuid-1', 'promoter-uuid-1']),
    );
  });
});

describe('suspendPromoter', () => {
  it('transitions status active → suspended and emits Kafka', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'active' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await suspendPromoter('promoter-uuid-1', 'Policy violation', 'admin-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'suspended'"),
      ['promoter-uuid-1'],
    );
    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.suspended',
      expect.objectContaining({ promoterId: 'promoter-uuid-1', reason: 'Policy violation' }),
    );
  });

  it('throws INVALID_STATUS_TRANSITION when status is pending', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'pending' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      suspendPromoter('promoter-uuid-1', 'reason', 'admin-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
  });
});

describe('activatePromoter', () => {
  it('transitions suspended → active when KYC is verified', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'suspended', kyc_status: 'verified' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await activatePromoter('promoter-uuid-1', 'admin-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ['promoter-uuid-1'],
    );
  });

  it('throws KYC_NOT_VERIFIED when KYC is not verified', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'suspended', kyc_status: 'submitted' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      activatePromoter('promoter-uuid-1', 'admin-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'KYC_NOT_VERIFIED' }));
  });

  it('throws INVALID_STATUS_TRANSITION when status is not suspended', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'active', kyc_status: 'verified' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      activatePromoter('promoter-uuid-1', 'admin-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
  });
});

describe('banPromoter', () => {
  it('transitions active → banned', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'active' })],
    ]);
    const kafka = makeKafka();
    const deps = makeDeps(db, kafka);

    await banPromoter('promoter-uuid-1', 'Fraud', 'admin-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'banned'"),
      ['promoter-uuid-1'],
    );
    expect(kafka.send).toHaveBeenCalledWith(
      'promoter.banned',
      expect.objectContaining({ promoterId: 'promoter-uuid-1', reason: 'Fraud' }),
    );
  });

  it('throws INVALID_STATUS_TRANSITION when status is pending', async () => {
    const db = makeDb([
      [makePromoterRow({ status: 'pending' })],
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      banPromoter('promoter-uuid-1', 'Fraud', 'admin-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'INVALID_STATUS_TRANSITION' }));
  });
});

describe('addMember', () => {
  it('adds a new team member successfully', async () => {
    const newMemberRow = makeMemberRow({ id: 'member-uuid-2', user_id: 'user-uuid-2', role: 'manager' });
    const db = makeDb([
      [makeMemberRow()],       // assertMemberAccess (invitedBy is owner)
      [],                      // check for existing member — none (no duplicate)
      [newMemberRow],          // INSERT RETURNING (role=manager, no owner check)
    ]);
    const deps = makeDeps(db, makeKafka());

    const member = await addMember('promoter-uuid-1', 'user-uuid-2', 'manager', 'user-uuid-1', deps);

    expect(member.userId).toBe('user-uuid-2');
    expect(member.role).toBe('manager');
  });

  it('throws MEMBER_ALREADY_EXISTS when user is already a member', async () => {
    const db = makeDb([
      [makeMemberRow()],                 // assertMemberAccess (invitedBy)
      [makeMemberRow({ user_id: 'user-uuid-2' })],  // existing member check — found
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      addMember('promoter-uuid-1', 'user-uuid-2', 'staff', 'user-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'MEMBER_ALREADY_EXISTS' }));
  });

  it('throws MEMBER_ALREADY_EXISTS when trying to add a second owner', async () => {
    const db = makeDb([
      [makeMemberRow()],  // assertMemberAccess
      [],                 // existing member check — none
      [makeMemberRow()],  // owner check — found existing owner
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      addMember('promoter-uuid-1', 'user-uuid-2', 'owner', 'user-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'MEMBER_ALREADY_EXISTS' }));
  });
});

describe('removeMember', () => {
  it('throws CANNOT_REMOVE_OWNER when trying to remove the owner', async () => {
    const ownerRow = makeMemberRow({ id: 'member-uuid-1', role: 'owner' });
    const db = makeDb([
      [ownerRow],   // assertMemberAccess (requesterId)
      [ownerRow],   // find member to remove
    ]);
    const deps = makeDeps(db, makeKafka());

    await expect(
      removeMember('promoter-uuid-1', 'member-uuid-1', 'user-uuid-1', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'CANNOT_REMOVE_OWNER' }));
  });

  it('soft-deletes non-owner member (sets status=deactivated)', async () => {
    const staffRow = makeMemberRow({ id: 'member-uuid-2', user_id: 'user-uuid-2', role: 'staff' });
    const db = makeDb([
      [makeMemberRow()],  // assertMemberAccess (owner requesterId)
      [staffRow],         // find member to remove
    ]);
    const deps = makeDeps(db, makeKafka());

    await removeMember('promoter-uuid-1', 'member-uuid-2', 'user-uuid-1', deps);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'deactivated'"),
      ['member-uuid-2'],
    );
  });
});

describe('assertMemberAccess', () => {
  it('returns member when active member has required role', async () => {
    const db = makeDb([[makeMemberRow({ role: 'admin' })]]);
    const deps = makeDeps(db, makeKafka());

    const member = await assertMemberAccess('promoter-uuid-1', 'user-uuid-1', ['owner', 'admin'], deps);

    expect(member.role).toBe('admin');
  });

  it('throws UNAUTHORIZED with statusCode 404 when member has wrong role', async () => {
    const db = makeDb([[makeMemberRow({ role: 'staff' })]]);
    const deps = makeDeps(db, makeKafka());

    let caughtErr: PlatformError | null = null;
    try {
      await assertMemberAccess('promoter-uuid-1', 'user-uuid-1', ['owner', 'admin'], deps);
    } catch (err) {
      caughtErr = err as PlatformError;
    }

    expect(caughtErr).not.toBeNull();
    expect(caughtErr!.code).toBe('UNAUTHORIZED');
    expect(caughtErr!.statusCode).toBe(404);
  });

  it('throws UNAUTHORIZED with statusCode 404 when user is not a member', async () => {
    const db = makeDb([[]]); // no member found
    const deps = makeDeps(db, makeKafka());

    await expect(
      assertMemberAccess('promoter-uuid-1', 'nonexistent-user', ['owner'], deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'UNAUTHORIZED', statusCode: 404 }));
  });
});

describe('updatePromoter', () => {
  it('owner can update profile', async () => {
    const updatedRow = makePromoterRow({ name: 'Updated Festival', slug: 'rock-festival-praha' });
    const db = makeDb([
      [makeMemberRow()],      // assertMemberAccess
      [makePromoterRow()],    // getPromoterById (current)
      [updatedRow],           // UPDATE RETURNING
    ]);
    const deps = makeDeps(db, makeKafka());

    const result = await updatePromoter(
      'promoter-uuid-1',
      { name: 'Updated Festival' },
      'user-uuid-1',
      deps,
    );

    expect(result.name).toBe('Updated Festival');
  });

  it('throws UNAUTHORIZED when caller is not a member', async () => {
    const db = makeDb([[]]); // no member found for assertMemberAccess
    const deps = makeDeps(db, makeKafka());

    await expect(
      updatePromoter('promoter-uuid-1', { name: 'Hacked' }, 'stranger-uuid', deps),
    ).rejects.toThrow(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });
});
