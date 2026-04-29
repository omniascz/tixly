import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSuite,
  allocateSeatsForEvent,
  inviteGuest,
  acceptInvitation,
  declineInvitation,
  cancelInvitation,
  requestDelegation,
  approveDelegation,
  rejectDelegation,
  getSuiteUsageReport,
  getGuestList,
} from '../services/corporate-suites.service';
import {
  CorporateSuiteError,
  CorporateSuite,
  SuiteAllocation,
  GuestInvitation,
  DelegationRequest,
  DbAdapter,
  ServiceDeps,
} from '../types/corporate-suites.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-15T10:00:00Z');

function makeDeps(overrides?: Partial<DbAdapter>): ServiceDeps {
  const db: DbAdapter = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(db)),
    ...overrides,
  };
  return { db, now: () => NOW };
}

function makeSuite(overrides: Partial<CorporateSuite> = {}): CorporateSuite {
  return {
    id: 'suite-1',
    organizerId: 'org-1',
    corporateName: 'Acme Corp',
    contactEmail: 'vip@acme.com',
    totalSeats: 20,
    status: 'active',
    contractStartDate: new Date('2026-01-01'),
    contractEndDate: new Date('2026-12-31'),
    notes: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeAllocation(overrides: Partial<SuiteAllocation> = {}): SuiteAllocation {
  return {
    id: 'alloc-1',
    suiteId: 'suite-1',
    eventId: 'event-1',
    seatsAllocated: 10,
    seatsUsed: 3,
    requestedBy: 'user-admin',
    status: 'allocated',
    allocatedAt: NOW,
    expiresAt: new Date('2026-05-01'),
    ...overrides,
  };
}

function makeInvitation(overrides: Partial<GuestInvitation> = {}): GuestInvitation {
  return {
    id: 'invite-1',
    allocationId: 'alloc-1',
    guestEmail: 'guest@example.com',
    guestName: 'Jana Nováková',
    invitedByUserId: 'user-admin',
    status: 'allocated',
    ticketId: null,
    invitedAt: NOW,
    respondedAt: null,
    notes: null,
    ...overrides,
  };
}

function makeDelegation(overrides: Partial<DelegationRequest> = {}): DelegationRequest {
  return {
    id: 'deleg-1',
    allocationId: 'alloc-1',
    fromUserId: 'user-admin',
    toUserId: 'user-manager',
    seatsRequested: 2,
    reason: 'Manager needs seats for team',
    status: 'pending',
    requestedAt: NOW,
    resolvedAt: null,
    ...overrides,
  };
}

// ── createSuite ──────────────────────────────────────────────────────────────

describe('createSuite', () => {
  it('inserts a suite and returns it with status active', async () => {
    const deps = makeDeps();
    const result = await createSuite(
      {
        organizerId: 'org-1',
        corporateName: 'Acme Corp',
        contactEmail: 'vip@acme.com',
        totalSeats: 20,
        contractStartDate: new Date('2026-01-01'),
        contractEndDate: new Date('2026-12-31'),
        notes: 'VIP suite',
      },
      deps,
    );

    expect(deps.db.execute).toHaveBeenCalledOnce();
    expect(result.status).toBe('active');
    expect(result.corporateName).toBe('Acme Corp');
    expect(result.organizerId).toBe('org-1');
    expect(result.totalSeats).toBe(20);
    expect(result.notes).toBe('VIP suite');
    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBe(NOW);
  });

  it('sets notes to null when not provided', async () => {
    const deps = makeDeps();
    const result = await createSuite(
      {
        organizerId: 'org-1',
        corporateName: 'Beta Inc',
        contactEmail: 'info@beta.com',
        totalSeats: 5,
        contractStartDate: new Date('2026-01-01'),
        contractEndDate: new Date('2026-06-30'),
      },
      deps,
    );

    expect(result.notes).toBeNull();
  });
});

// ── allocateSeatsForEvent ────────────────────────────────────────────────────

describe('allocateSeatsForEvent', () => {
  it('creates allocation when suite is active and seats are sufficient', async () => {
    const suite = makeSuite();
    const deps = makeDeps({
      query: vi.fn(async () => [suite] as CorporateSuite[]),
    });

    const result = await allocateSeatsForEvent(
      {
        suiteId: 'suite-1',
        eventId: 'event-42',
        seatsAllocated: 10,
        requestedBy: 'user-admin',
        expiresAt: new Date('2026-05-01'),
      },
      deps,
    );

    expect(deps.db.execute).toHaveBeenCalledOnce();
    expect(result.suiteId).toBe('suite-1');
    expect(result.eventId).toBe('event-42');
    expect(result.seatsAllocated).toBe(10);
    expect(result.seatsUsed).toBe(0);
    expect(result.status).toBe('allocated');
    expect(result.id).toBeTruthy();
  });

  it('throws SUITE_NOT_FOUND when suite does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(
      allocateSeatsForEvent(
        { suiteId: 'missing', eventId: 'event-1', seatsAllocated: 5, requestedBy: 'user-1', expiresAt: new Date() },
        deps,
      ),
    ).rejects.toThrow(CorporateSuiteError);

    await expect(
      allocateSeatsForEvent(
        { suiteId: 'missing', eventId: 'event-1', seatsAllocated: 5, requestedBy: 'user-1', expiresAt: new Date() },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SUITE_NOT_FOUND' });
  });

  it('throws SUITE_SUSPENDED when suite is suspended', async () => {
    const suite = makeSuite({ status: 'suspended' });
    const deps = makeDeps({
      query: vi.fn(async () => [suite] as CorporateSuite[]),
    });

    await expect(
      allocateSeatsForEvent(
        { suiteId: 'suite-1', eventId: 'event-1', seatsAllocated: 5, requestedBy: 'user-1', expiresAt: new Date() },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SUITE_SUSPENDED' });
  });

  it('throws INSUFFICIENT_SEATS when seatsAllocated exceeds totalSeats', async () => {
    const suite = makeSuite({ totalSeats: 10 });
    const deps = makeDeps({
      query: vi.fn(async () => [suite] as CorporateSuite[]),
    });

    await expect(
      allocateSeatsForEvent(
        { suiteId: 'suite-1', eventId: 'event-1', seatsAllocated: 15, requestedBy: 'user-1', expiresAt: new Date() },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SEATS' });
  });
});

// ── inviteGuest ──────────────────────────────────────────────────────────────

describe('inviteGuest', () => {
  it('creates a guest invitation when allocation has capacity', async () => {
    const allocation = makeAllocation({ seatsAllocated: 10 });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([allocation])  // allocation lookup
      .mockResolvedValueOnce([])            // duplicate check
      .mockResolvedValueOnce([]);           // current invitations count

    const deps = makeDeps({ query: queryMock });

    const result = await inviteGuest(
      {
        allocationId: 'alloc-1',
        guestEmail: 'newguest@example.com',
        guestName: 'Petr Kovář',
        invitedByUserId: 'user-admin',
        notes: 'VIP guest',
      },
      deps,
    );

    expect(deps.db.execute).toHaveBeenCalledOnce();
    expect(result.guestEmail).toBe('newguest@example.com');
    expect(result.guestName).toBe('Petr Kovář');
    expect(result.status).toBe('allocated');
    expect(result.ticketId).toBeNull();
    expect(result.allocationId).toBe('alloc-1');
  });

  it('throws ALLOCATION_NOT_FOUND when allocation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(
      inviteGuest(
        { allocationId: 'missing', guestEmail: 'g@example.com', guestName: 'Guest', invitedByUserId: 'user-1' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' });
  });

  it('throws ALREADY_INVITED when guest email is duplicate for same allocation', async () => {
    const allocation = makeAllocation();
    const existingInvite = makeInvitation({ guestEmail: 'guest@example.com' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([allocation])       // allocation lookup
      .mockResolvedValueOnce([existingInvite]);   // duplicate check finds one

    const deps = makeDeps({ query: queryMock });

    await expect(
      inviteGuest(
        { allocationId: 'alloc-1', guestEmail: 'guest@example.com', guestName: 'Guest', invitedByUserId: 'user-1' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'ALREADY_INVITED' });
  });

  it('throws INSUFFICIENT_SEATS when all seats are taken', async () => {
    const allocation = makeAllocation({ seatsAllocated: 2 });
    // Two active invitations already exist
    const inv1 = makeInvitation({ id: 'i1' });
    const inv2 = makeInvitation({ id: 'i2' });
    const queryMock = vi.fn()
      .mockResolvedValueOnce([allocation])   // allocation lookup
      .mockResolvedValueOnce([])             // duplicate check: no duplicate
      .mockResolvedValueOnce([inv1, inv2]);  // current invitations = 2 = seatsAllocated

    const deps = makeDeps({ query: queryMock });

    await expect(
      inviteGuest(
        { allocationId: 'alloc-1', guestEmail: 'new@example.com', guestName: 'New Guest', invitedByUserId: 'user-1' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SEATS' });
  });
});

// ── acceptInvitation ─────────────────────────────────────────────────────────

describe('acceptInvitation', () => {
  it('sets status to accepted and assigns a ticketId', async () => {
    const invitation = makeInvitation();
    const deps = makeDeps({
      query: vi.fn(async () => [invitation] as GuestInvitation[]),
    });

    const result = await acceptInvitation('invite-1', deps);

    expect(result.status).toBe('accepted');
    expect(result.ticketId).toBeTruthy();
    expect(result.respondedAt).toBe(NOW);
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws INVITATION_NOT_FOUND when invitation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(acceptInvitation('missing', deps)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    });
  });
});

// ── declineInvitation ────────────────────────────────────────────────────────

describe('declineInvitation', () => {
  it('sets status to declined and sets respondedAt', async () => {
    const invitation = makeInvitation();
    const deps = makeDeps({
      query: vi.fn(async () => [invitation] as GuestInvitation[]),
    });

    const result = await declineInvitation('invite-1', deps);

    expect(result.status).toBe('declined');
    expect(result.respondedAt).toBe(NOW);
    expect(result.ticketId).toBeNull();
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws INVITATION_NOT_FOUND when invitation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(declineInvitation('missing', deps)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    });
  });
});

// ── cancelInvitation ─────────────────────────────────────────────────────────

describe('cancelInvitation', () => {
  it('cancels invitation when requestedBy is invitedByUserId', async () => {
    const invitation = makeInvitation({ invitedByUserId: 'user-admin' });
    const deps = makeDeps({
      query: vi.fn(async () => [invitation] as GuestInvitation[]),
    });

    const result = await cancelInvitation('invite-1', 'user-admin', deps);

    expect(result.status).toBe('cancelled');
    expect(result.respondedAt).toBe(NOW);
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('cancels invitation when requestedBy is the guest email', async () => {
    const invitation = makeInvitation({ guestEmail: 'guest@example.com' });
    const deps = makeDeps({
      query: vi.fn(async () => [invitation] as GuestInvitation[]),
    });

    const result = await cancelInvitation('invite-1', 'guest@example.com', deps);

    expect(result.status).toBe('cancelled');
  });

  it('throws INVITATION_NOT_FOUND when invitation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(cancelInvitation('missing', 'user-1', deps)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    });
  });
});

// ── requestDelegation ────────────────────────────────────────────────────────

describe('requestDelegation', () => {
  it('creates a delegation request with status pending', async () => {
    const allocation = makeAllocation();
    const deps = makeDeps({
      query: vi.fn(async () => [allocation] as SuiteAllocation[]),
    });

    const result = await requestDelegation(
      {
        allocationId: 'alloc-1',
        fromUserId: 'user-admin',
        toUserId: 'user-manager',
        seatsRequested: 3,
        reason: 'Team event',
      },
      deps,
    );

    expect(result.status).toBe('pending');
    expect(result.allocationId).toBe('alloc-1');
    expect(result.fromUserId).toBe('user-admin');
    expect(result.toUserId).toBe('user-manager');
    expect(result.seatsRequested).toBe(3);
    expect(result.resolvedAt).toBeNull();
    expect(result.id).toBeTruthy();
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws ALLOCATION_NOT_FOUND when allocation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(
      requestDelegation(
        { allocationId: 'missing', fromUserId: 'u1', toUserId: 'u2', seatsRequested: 1, reason: 'test' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' });
  });
});

// ── approveDelegation ────────────────────────────────────────────────────────

describe('approveDelegation', () => {
  it('sets delegation status to approved and sets resolvedAt', async () => {
    const delegation = makeDelegation();
    const deps = makeDeps({
      query: vi.fn(async () => [delegation] as DelegationRequest[]),
    });

    const result = await approveDelegation('deleg-1', 'approver-1', deps);

    expect(result.status).toBe('approved');
    expect(result.resolvedAt).toBe(NOW);
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws DELEGATION_NOT_FOUND when delegation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(approveDelegation('missing', 'approver-1', deps)).rejects.toMatchObject({
      code: 'DELEGATION_NOT_FOUND',
    });
  });
});

// ── rejectDelegation ─────────────────────────────────────────────────────────

describe('rejectDelegation', () => {
  it('sets delegation status to rejected and sets resolvedAt', async () => {
    const delegation = makeDelegation();
    const deps = makeDeps({
      query: vi.fn(async () => [delegation] as DelegationRequest[]),
    });

    const result = await rejectDelegation('deleg-1', 'approver-1', 'Not authorized', deps);

    expect(result.status).toBe('rejected');
    expect(result.resolvedAt).toBe(NOW);
    expect(deps.db.execute).toHaveBeenCalledOnce();
  });

  it('throws DELEGATION_NOT_FOUND when delegation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(rejectDelegation('missing', 'approver-1', 'reason', deps)).rejects.toMatchObject({
      code: 'DELEGATION_NOT_FOUND',
    });
  });
});

// ── getSuiteUsageReport ──────────────────────────────────────────────────────

describe('getSuiteUsageReport', () => {
  it('calculates correct utilizationRate from allocations', async () => {
    const suite = makeSuite();
    const allocations: SuiteAllocation[] = [
      makeAllocation({ id: 'a1', eventId: 'event-1', seatsAllocated: 10, seatsUsed: 8 }),
      makeAllocation({ id: 'a2', eventId: 'event-2', seatsAllocated: 6, seatsUsed: 3 }),
    ];
    const queryMock = vi.fn()
      .mockResolvedValueOnce([suite])
      .mockResolvedValueOnce(allocations);

    const deps = makeDeps({ query: queryMock });

    const report = await getSuiteUsageReport('suite-1', deps);

    expect(report.suiteId).toBe('suite-1');
    expect(report.corporateName).toBe('Acme Corp');
    expect(report.totalAllocations).toBe(2);
    expect(report.totalSeatsAllocated).toBe(16);
    expect(report.totalSeatsUsed).toBe(11);
    // utilizationRate = 11/16
    expect(report.utilizationRate).toBeCloseTo(11 / 16);
    expect(report.events).toHaveLength(2);
    expect(report.events[0]).toEqual({ eventId: 'event-1', seatsAllocated: 10, seatsUsed: 8 });
    expect(report.events[1]).toEqual({ eventId: 'event-2', seatsAllocated: 6, seatsUsed: 3 });
  });

  it('returns utilizationRate of 0 when no allocations exist', async () => {
    const suite = makeSuite();
    const queryMock = vi.fn()
      .mockResolvedValueOnce([suite])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query: queryMock });

    const report = await getSuiteUsageReport('suite-1', deps);

    expect(report.totalAllocations).toBe(0);
    expect(report.totalSeatsAllocated).toBe(0);
    expect(report.totalSeatsUsed).toBe(0);
    expect(report.utilizationRate).toBe(0);
    expect(report.events).toHaveLength(0);
  });

  it('throws SUITE_NOT_FOUND when suite does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(getSuiteUsageReport('missing', deps)).rejects.toMatchObject({
      code: 'SUITE_NOT_FOUND',
    });
  });

  it('calculates 100% utilizationRate when all seats are used', async () => {
    const suite = makeSuite();
    const allocations: SuiteAllocation[] = [
      makeAllocation({ seatsAllocated: 5, seatsUsed: 5 }),
    ];
    const queryMock = vi.fn()
      .mockResolvedValueOnce([suite])
      .mockResolvedValueOnce(allocations);

    const deps = makeDeps({ query: queryMock });

    const report = await getSuiteUsageReport('suite-1', deps);

    expect(report.utilizationRate).toBe(1);
  });
});

// ── getGuestList ─────────────────────────────────────────────────────────────

describe('getGuestList', () => {
  it('returns all guest invitations for an allocation', async () => {
    const allocation = makeAllocation();
    const invitations = [
      makeInvitation({ id: 'i1', guestEmail: 'a@example.com' }),
      makeInvitation({ id: 'i2', guestEmail: 'b@example.com' }),
      makeInvitation({ id: 'i3', guestEmail: 'c@example.com', status: 'accepted' }),
    ];
    const queryMock = vi.fn()
      .mockResolvedValueOnce([allocation])
      .mockResolvedValueOnce(invitations);

    const deps = makeDeps({ query: queryMock });

    const result = await getGuestList('alloc-1', deps);

    expect(result).toHaveLength(3);
    expect(result[0]?.guestEmail).toBe('a@example.com');
    expect(result[2]?.status).toBe('accepted');
  });

  it('returns empty array when no guests have been invited', async () => {
    const allocation = makeAllocation();
    const queryMock = vi.fn()
      .mockResolvedValueOnce([allocation])
      .mockResolvedValueOnce([]);

    const deps = makeDeps({ query: queryMock });

    const result = await getGuestList('alloc-1', deps);

    expect(result).toHaveLength(0);
  });

  it('throws ALLOCATION_NOT_FOUND when allocation does not exist', async () => {
    const deps = makeDeps({
      query: vi.fn(async () => []),
    });

    await expect(getGuestList('missing', deps)).rejects.toMatchObject({
      code: 'ALLOCATION_NOT_FOUND',
    });
  });
});
