import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAllocation,
  issueComp,
  batchIssueComps,
  revokeComp,
  recordAttendance,
  getAllocationStats,
  searchComps,
  getAuditTrail,
} from '../services/comp-tickets.service'
import type {
  CompAllocation,
  CompTicket,
  DbAdapter,
  ServiceDeps,
  AuditEntry,
} from '../types/comp-tickets.types'
import { CompTicketError } from '../types/comp-tickets.types'

// ── Factories ──────────────────────────────────────────────────────────────

function makeAllocation(overrides: Partial<CompAllocation> = {}): CompAllocation {
  return {
    id: 'alloc-1',
    eventId: 'event-1',
    organizerId: 'org-1',
    category: 'vip_guest',
    totalAllotted: 10,
    totalIssued: 0,
    notes: null,
    status: 'active',
    createdAt: new Date('2026-04-01T10:00:00Z'),
    ...overrides,
  }
}

function makeTicket(overrides: Partial<CompTicket> = {}): CompTicket {
  return {
    id: 'ticket-1',
    allocationId: 'alloc-1',
    eventId: 'event-1',
    organizerId: 'org-1',
    recipientName: 'Jana Novákova',
    recipientEmail: 'jana@example.com',
    category: 'vip_guest',
    status: 'issued',
    issuedAt: new Date('2026-04-10T12:00:00Z'),
    redeemedAt: null,
    revokedAt: null,
    revokeReason: null,
    issuedByUserId: 'user-1',
    notes: null,
    ...overrides,
  }
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    action: 'issued',
    compTicketId: 'ticket-1',
    actorUserId: 'user-1',
    details: 'Issued to Jana',
    occurredAt: new Date('2026-04-10T12:00:00Z'),
    ...overrides,
  }
}

function makeDb(): DbAdapter {
  return {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(makeDb())),
  }
}

function makeDeps(db?: DbAdapter): ServiceDeps {
  return { db: db ?? makeDb() }
}

// ── createAllocation ────────────────────────────────────────────────────────

describe('createAllocation', () => {
  it('inserts allocation and returns it', async () => {
    const allocation = makeAllocation()
    const db = makeDb()
    ;(db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([allocation])

    const result = await createAllocation(
      { eventId: 'event-1', organizerId: 'org-1', category: 'vip_guest', totalAllotted: 10 },
      makeDeps(db),
    )

    expect(db.execute).toHaveBeenCalledOnce()
    expect(db.query).toHaveBeenCalledOnce()
    expect(result).toBe(allocation)
  })

  it('passes notes to insert when provided', async () => {
    const allocation = makeAllocation({ notes: 'Festival comps' })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([allocation])

    await createAllocation(
      { eventId: 'event-1', organizerId: 'org-1', category: 'press_media', totalAllotted: 5, notes: 'Festival comps' },
      makeDeps(db),
    )

    const executeCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(executeCall[1]).toContain('Festival comps')
  })

  it('throws ALLOCATION_NOT_FOUND when query returns empty after insert', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      createAllocation(
        { eventId: 'event-1', organizerId: 'org-1', category: 'staff', totalAllotted: 2 },
        makeDeps(db),
      ),
    ).rejects.toThrow(CompTicketError)
  })
})

// ── issueComp ───────────────────────────────────────────────────────────────

describe('issueComp', () => {
  it('issues a comp ticket when allocation has remaining slots', async () => {
    const allocation = makeAllocation({ totalIssued: 2, totalAllotted: 10 })
    const ticket = makeTicket()
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])  // allocation fetch
      .mockResolvedValueOnce([ticket])       // ticket fetch

    const result = await issueComp(
      { allocationId: 'alloc-1', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
      makeDeps(db),
    )

    expect(db.execute).toHaveBeenCalledTimes(3) // insert ticket, update alloc, insert audit
    expect(result).toBe(ticket)
  })

  it('sets allocation status to exhausted when last slot is taken', async () => {
    const allocation = makeAllocation({ totalIssued: 9, totalAllotted: 10 })
    const ticket = makeTicket()
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])
      .mockResolvedValueOnce([ticket])

    await issueComp(
      { allocationId: 'alloc-1', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
      makeDeps(db),
    )

    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]]
    expect(updateCall[1]).toContain('exhausted')
  })

  it('keeps allocation active when slots remain after issue', async () => {
    const allocation = makeAllocation({ totalIssued: 3, totalAllotted: 10 })
    const ticket = makeTicket()
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])
      .mockResolvedValueOnce([ticket])

    await issueComp(
      { allocationId: 'alloc-1', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
      makeDeps(db),
    )

    const updateCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]]
    expect(updateCall[1]).toContain('active')
  })

  it('throws ALLOCATION_NOT_FOUND when allocation does not exist', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      issueComp(
        { allocationId: 'missing', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
        makeDeps(db),
      ),
    ).rejects.toThrow(CompTicketError)

    await expect(
      issueComp(
        { allocationId: 'missing', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' })
  })

  it('throws ALLOCATION_EXHAUSTED when all slots are taken', async () => {
    const allocation = makeAllocation({ totalIssued: 10, totalAllotted: 10, status: 'exhausted' })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([allocation])

    await expect(
      issueComp(
        { allocationId: 'alloc-1', recipientName: 'Jana', recipientEmail: 'jana@example.com', issuedByUserId: 'user-1' },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_EXHAUSTED' })
  })
})

// ── batchIssueComps ─────────────────────────────────────────────────────────

describe('batchIssueComps', () => {
  it('returns all succeeded when all recipients get tickets', async () => {
    const allocation = makeAllocation({ totalIssued: 0, totalAllotted: 10 })
    const ticket1 = makeTicket({ id: 't-1', recipientName: 'Alice', recipientEmail: 'alice@example.com' })
    const ticket2 = makeTicket({ id: 't-2', recipientName: 'Bob', recipientEmail: 'bob@example.com' })

    const db = makeDb()
    // First call: allocation check in batchIssueComps
    // Then 2 × (allocation fetch + ticket fetch) inside issueComp calls
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])  // batchIssueComps allocation check
      .mockResolvedValueOnce([allocation])  // issueComp #1 allocation fetch
      .mockResolvedValueOnce([ticket1])     // issueComp #1 ticket fetch
      .mockResolvedValueOnce([allocation])  // issueComp #2 allocation fetch
      .mockResolvedValueOnce([ticket2])     // issueComp #2 ticket fetch

    const result = await batchIssueComps(
      {
        allocationId: 'alloc-1',
        recipients: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
        issuedByUserId: 'user-1',
      },
      makeDeps(db),
    )

    expect(result.succeeded).toHaveLength(2)
    expect(result.failed).toHaveLength(0)
  })

  it('returns partial success when some recipients fail', async () => {
    const allocation = makeAllocation({ totalIssued: 9, totalAllotted: 10 })
    const exhaustedAllocation = makeAllocation({ totalIssued: 10, totalAllotted: 10, status: 'exhausted' })
    const ticket = makeTicket({ id: 't-1', recipientName: 'Alice' })

    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])          // batchIssueComps allocation check
      .mockResolvedValueOnce([allocation])          // issueComp #1 allocation fetch (9/10)
      .mockResolvedValueOnce([ticket])              // issueComp #1 ticket fetch
      .mockResolvedValueOnce([exhaustedAllocation]) // issueComp #2 allocation fetch (10/10)

    const result = await batchIssueComps(
      {
        allocationId: 'alloc-1',
        recipients: [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ],
        issuedByUserId: 'user-1',
      },
      makeDeps(db),
    )

    expect(result.succeeded).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.error).toBeInstanceOf(CompTicketError)
    expect(result.failed[0]?.error.code).toBe('ALLOCATION_EXHAUSTED')
  })

  it('throws ALLOCATION_NOT_FOUND when allocation missing before batch starts', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      batchIssueComps(
        { allocationId: 'missing', recipients: [{ name: 'A', email: 'a@b.com' }], issuedByUserId: 'user-1' },
        makeDeps(db),
      ),
    ).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' })
  })
})

// ── revokeComp ──────────────────────────────────────────────────────────────

describe('revokeComp', () => {
  it('marks ticket as revoked and decrements allocation totalIssued', async () => {
    const ticket = makeTicket({ status: 'issued' })
    const allocation = makeAllocation({ totalIssued: 5, status: 'active' })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([ticket])
      .mockResolvedValueOnce([allocation])

    const result = await revokeComp('ticket-1', 'No longer attending', 'user-1', makeDeps(db))

    expect(result.status).toBe('revoked')
    expect(result.revokeReason).toBe('No longer attending')
    expect(result.revokedAt).toBeInstanceOf(Date)

    const updateAllocCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]]
    expect(updateAllocCall[1]).toContain(4) // newTotalIssued = 5 - 1
  })

  it('reactivates exhausted allocation when revoking a ticket', async () => {
    const ticket = makeTicket({ status: 'issued' })
    const allocation = makeAllocation({ totalIssued: 10, totalAllotted: 10, status: 'exhausted' })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([ticket])
      .mockResolvedValueOnce([allocation])

    await revokeComp('ticket-1', 'Cancelled', 'user-1', makeDeps(db))

    const updateAllocCall = (db.execute as ReturnType<typeof vi.fn>).mock.calls[1] as [string, unknown[]]
    expect(updateAllocCall[1]).toContain('active')
  })

  it('throws TICKET_NOT_FOUND for non-existent ticket', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      revokeComp('missing', 'reason', 'user-1', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_ALREADY_REVOKED when ticket is already revoked', async () => {
    const ticket = makeTicket({ status: 'revoked', revokedAt: new Date() })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([ticket])

    await expect(
      revokeComp('ticket-1', 'reason', 'user-1', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'TICKET_ALREADY_REVOKED' })
  })
})

// ── recordAttendance ────────────────────────────────────────────────────────

describe('recordAttendance', () => {
  it('marks ticket as redeemed and sets redeemedAt', async () => {
    const ticket = makeTicket({ status: 'issued' })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([ticket])

    const result = await recordAttendance('ticket-1', makeDeps(db))

    expect(result.status).toBe('redeemed')
    expect(result.redeemedAt).toBeInstanceOf(Date)
    expect(db.execute).toHaveBeenCalledTimes(2) // update ticket + audit log
  })

  it('throws TICKET_NOT_FOUND for non-existent ticket', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      recordAttendance('missing', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_ALREADY_REDEEMED when ticket is already redeemed', async () => {
    const ticket = makeTicket({ status: 'redeemed', redeemedAt: new Date() })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([ticket])

    await expect(
      recordAttendance('ticket-1', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'TICKET_ALREADY_REDEEMED' })
  })
})

// ── getAllocationStats ───────────────────────────────────────────────────────

describe('getAllocationStats', () => {
  it('returns correct counts for all statuses', async () => {
    const allocation = makeAllocation({ totalAllotted: 10, totalIssued: 7 })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])   // allocation
      .mockResolvedValueOnce([{ count: 4 }]) // redeemed
      .mockResolvedValueOnce([{ count: 2 }]) // revoked

    const stats = await getAllocationStats('alloc-1', makeDeps(db))

    expect(stats.allocationId).toBe('alloc-1')
    expect(stats.category).toBe('vip_guest')
    expect(stats.totalAllotted).toBe(10)
    expect(stats.totalIssued).toBe(7)
    expect(stats.totalRedeemed).toBe(4)
    expect(stats.totalRevoked).toBe(2)
    expect(stats.remaining).toBe(3) // 10 - 7
  })

  it('returns zero counts when no tickets have been issued', async () => {
    const allocation = makeAllocation({ totalAllotted: 5, totalIssued: 0 })
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([allocation])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 0 }])

    const stats = await getAllocationStats('alloc-1', makeDeps(db))

    expect(stats.totalIssued).toBe(0)
    expect(stats.totalRedeemed).toBe(0)
    expect(stats.totalRevoked).toBe(0)
    expect(stats.remaining).toBe(5)
  })

  it('throws ALLOCATION_NOT_FOUND for unknown allocation', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await expect(
      getAllocationStats('missing', makeDeps(db)),
    ).rejects.toMatchObject({ code: 'ALLOCATION_NOT_FOUND' })
  })
})

// ── searchComps ─────────────────────────────────────────────────────────────

describe('searchComps', () => {
  it('returns all comps for event and organizer without filters', async () => {
    const tickets = [makeTicket({ id: 't-1' }), makeTicket({ id: 't-2' })]
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue(tickets)

    const result = await searchComps('event-1', 'org-1', {}, makeDeps(db))

    expect(result).toHaveLength(2)
    const queryCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(queryCall[1]).toContain('event-1')
    expect(queryCall[1]).toContain('org-1')
  })

  it('applies category filter when provided', async () => {
    const tickets = [makeTicket({ category: 'press_media' })]
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue(tickets)

    const result = await searchComps('event-1', 'org-1', { category: 'press_media' }, makeDeps(db))

    expect(result).toHaveLength(1)
    const queryCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(queryCall[1]).toContain('press_media')
  })

  it('applies status filter when provided', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeTicket({ status: 'redeemed' })])

    const result = await searchComps('event-1', 'org-1', { status: 'redeemed' }, makeDeps(db))

    expect(result).toHaveLength(1)
    const queryCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(queryCall[1]).toContain('redeemed')
  })

  it('applies search filter with ILIKE pattern when provided', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([makeTicket()])

    await searchComps('event-1', 'org-1', { search: 'jana' }, makeDeps(db))

    const queryCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(queryCall[1]).toContain('%jana%')
  })

  it('returns empty array when no comps match', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await searchComps('event-1', 'org-1', { search: 'nobody' }, makeDeps(db))

    expect(result).toHaveLength(0)
  })
})

// ── getAuditTrail ────────────────────────────────────────────────────────────

describe('getAuditTrail', () => {
  it('returns audit entries ordered by occurredAt desc', async () => {
    const entries = [
      makeAuditEntry({ action: 'redeemed', occurredAt: new Date('2026-04-12T10:00:00Z') }),
      makeAuditEntry({ action: 'issued', occurredAt: new Date('2026-04-10T12:00:00Z') }),
    ]
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue(entries)

    const result = await getAuditTrail('event-1', 'org-1', makeDeps(db))

    expect(result).toHaveLength(2)
    expect(result[0]?.action).toBe('redeemed')
    expect(result[1]?.action).toBe('issued')
  })

  it('returns empty array when no audit entries exist', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await getAuditTrail('event-1', 'org-1', makeDeps(db))

    expect(result).toHaveLength(0)
  })

  it('passes eventId and organizerId as query params', async () => {
    const db = makeDb()
    ;(db.query as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await getAuditTrail('event-42', 'org-99', makeDeps(db))

    const queryCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]]
    expect(queryCall[1]).toContain('event-42')
    expect(queryCall[1]).toContain('org-99')
  })
})
