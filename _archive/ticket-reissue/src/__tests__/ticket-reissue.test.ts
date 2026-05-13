import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  requestReissue,
  approveReissue,
  processReissue,
  swapTickets,
  changeDeliveryMethod,
  getReissueHistory,
} from '../services/ticket-reissue.service'
import type { DbAdapter, ServiceDeps, ReissueInput, SwapInput, ChangeDeliveryInput } from '../types/ticket-reissue.types'
import { ReissueError } from '../types/ticket-reissue.types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReissueRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    ticket_id: 'ticket-1',
    order_id: 'order-1',
    user_id: 'user-1',
    reason: 'damaged_ticket',
    status: 'pending',
    notes: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_reason: null,
    new_ticket_id: null,
    requested_at: new Date('2026-04-15T10:00:00Z'),
    processed_at: null,
    ...overrides,
  }
}

function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(async (fn) => fn(makeDb(overrides))),
    ...overrides,
  }
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}): ServiceDeps {
  return { db: makeDb(dbOverrides) }
}

// Ownership mock: returns a row with user_id matching userId
function ownedByUser(userId: string) {
  return [{ user_id: userId }]
}

// ── requestReissue ───────────────────────────────────────────────────────────

describe('requestReissue', () => {
  it('creates a pending request for a valid ticket owned by user', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId)) // ticket ownership check
        .mockResolvedValueOnce([]),                 // no same-day reissues
      execute: vi.fn(async () => undefined),
    })
    const deps: ServiceDeps = { db }

    const input: ReissueInput = {
      ticketId: 'ticket-1',
      orderId: 'order-1',
      userId,
      reason: 'damaged_ticket',
      notes: 'The barcode is scratched',
    }

    const result = await requestReissue(input, deps)

    expect(result.ticketId).toBe('ticket-1')
    expect(result.userId).toBe(userId)
    expect(result.reason).toBe('damaged_ticket')
    expect(result.status).toBe('pending')
    expect(result.notes).toBe('The barcode is scratched')
    expect(result.newTicketId).toBeNull()
    expect(db.execute).toHaveBeenCalledOnce()
  })

  it('auto-approves request when reason is scanner_failure', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))
        .mockResolvedValueOnce([]),
      execute: vi.fn(async () => undefined),
    })
    const deps: ServiceDeps = { db }

    const result = await requestReissue(
      { ticketId: 'ticket-1', orderId: 'order-1', userId, reason: 'scanner_failure' },
      deps,
    )

    expect(result.status).toBe('approved')
  })

  it('throws ALREADY_REISSUED_TODAY when a same-day request already exists', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))
        .mockResolvedValueOnce([{ id: 'existing-req' }]), // existing same-day request
    })
    const deps: ServiceDeps = { db }

    await expect(
      requestReissue({ ticketId: 'ticket-1', orderId: 'order-1', userId, reason: 'other' }, deps),
    ).rejects.toMatchObject({ code: 'ALREADY_REISSUED_TODAY' })
  })

  it('throws TICKET_NOT_FOUND when ticket does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]), // no ticket found
    })
    const deps: ServiceDeps = { db }

    await expect(
      requestReissue({ ticketId: 'missing', orderId: 'order-1', userId: 'user-1', reason: 'other' }, deps),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_NOT_OWNED_BY_USER when ticket belongs to different user', async () => {
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce([{ user_id: 'other-user' }]) // owned by someone else
        .mockResolvedValueOnce([]),
    })
    const deps: ServiceDeps = { db }

    await expect(
      requestReissue({ ticketId: 'ticket-1', orderId: 'order-1', userId: 'user-1', reason: 'other' }, deps),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_OWNED_BY_USER' })
  })

  it('stores null notes when notes are not provided', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))
        .mockResolvedValueOnce([]),
      execute: vi.fn(async () => undefined),
    })

    const result = await requestReissue(
      { ticketId: 'ticket-1', orderId: 'order-1', userId, reason: 'delivery_change' },
      { db },
    )

    expect(result.notes).toBeNull()
  })
})

// ── approveReissue ───────────────────────────────────────────────────────────

describe('approveReissue', () => {
  it('approves an existing pending request', async () => {
    const row = makeReissueRequestRow({ status: 'pending' })
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([row]),
      execute: vi.fn(async () => undefined),
    })

    const result = await approveReissue('req-1', 'admin-1', { db })

    expect(result.status).toBe('approved')
    expect(result.approvedByUserId).toBe('admin-1')
    expect(result.approvedAt).toBeInstanceOf(Date)
    expect(db.execute).toHaveBeenCalledOnce()
  })

  it('throws REQUEST_NOT_FOUND when request does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    })

    await expect(
      approveReissue('missing-req', 'admin-1', { db }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' })
  })
})

// ── processReissue ───────────────────────────────────────────────────────────

describe('processReissue', () => {
  it('processes an approved request: creates new ticket, voids old, updates request', async () => {
    const row = makeReissueRequestRow({ status: 'approved' })
    const txExecute = vi.fn(async () => undefined)
    const txDb = makeDb({ execute: txExecute })
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([row]),
      transaction: vi.fn(async (fn) => fn(txDb)),
    })

    const result = await processReissue('req-1', { db })

    expect(result.status).toBe('processed')
    expect(result.newTicketId).toBeTruthy()
    expect(result.processedAt).toBeInstanceOf(Date)
    // 3 executes: INSERT new ticket, UPDATE void old, UPDATE request
    expect(txExecute).toHaveBeenCalledTimes(3)
  })

  it('throws REQUEST_NOT_FOUND when request does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    })

    await expect(
      processReissue('missing-req', { db }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_FOUND' })
  })

  it('throws REQUEST_NOT_APPROVED when status is pending', async () => {
    const row = makeReissueRequestRow({ status: 'pending' })
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([row]),
    })

    await expect(
      processReissue('req-1', { db }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_APPROVED' })
  })

  it('throws REQUEST_NOT_APPROVED when status is rejected', async () => {
    const row = makeReissueRequestRow({ status: 'rejected' })
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([row]),
    })

    await expect(
      processReissue('req-1', { db }),
    ).rejects.toMatchObject({ code: 'REQUEST_NOT_APPROVED' })
  })

  it('throws REQUEST_ALREADY_PROCESSED when status is already processed', async () => {
    const row = makeReissueRequestRow({ status: 'processed', new_ticket_id: 'new-t-1', processed_at: new Date() })
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([row]),
    })

    await expect(
      processReissue('req-1', { db }),
    ).rejects.toMatchObject({ code: 'REQUEST_ALREADY_PROCESSED' })
  })
})

// ── swapTickets ──────────────────────────────────────────────────────────────

describe('swapTickets', () => {
  it('records swap and marks both tickets when valid', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId)) // fromTicket ownership
        .mockResolvedValueOnce(ownedByUser(userId)), // toTicket ownership
      execute: vi.fn(async () => undefined),
    })

    const input: SwapInput = {
      fromTicketId: 'ticket-A',
      toTicketId: 'ticket-B',
      userId,
      reason: 'Better seat',
    }

    await expect(swapTickets(input, { db })).resolves.toBeUndefined()
    // 1 INSERT for swap record + 2 UPDATEs for swap_partner_id
    expect(db.execute).toHaveBeenCalledTimes(3)
  })

  it('throws SWAP_TICKETS_SAME when fromTicketId equals toTicketId', async () => {
    const input: SwapInput = {
      fromTicketId: 'ticket-A',
      toTicketId: 'ticket-A',
      userId: 'user-1',
      reason: 'test',
    }

    await expect(swapTickets(input, makeDeps())).rejects.toMatchObject({ code: 'SWAP_TICKETS_SAME' })
  })

  it('throws TICKET_NOT_FOUND when fromTicket does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]), // fromTicket not found
    })

    const input: SwapInput = {
      fromTicketId: 'missing',
      toTicketId: 'ticket-B',
      userId: 'user-1',
      reason: 'test',
    }

    await expect(swapTickets(input, { db })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_NOT_FOUND when toTicket does not exist', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId)) // fromTicket found
        .mockResolvedValueOnce([]),                 // toTicket not found
    })

    const input: SwapInput = {
      fromTicketId: 'ticket-A',
      toTicketId: 'missing',
      userId,
      reason: 'test',
    }

    await expect(swapTickets(input, { db })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_NOT_OWNED_BY_USER when fromTicket belongs to another user', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ user_id: 'other-user' }]),
    })

    const input: SwapInput = {
      fromTicketId: 'ticket-A',
      toTicketId: 'ticket-B',
      userId: 'user-1',
      reason: 'test',
    }

    await expect(swapTickets(input, { db })).rejects.toMatchObject({ code: 'TICKET_NOT_OWNED_BY_USER' })
  })
})

// ── changeDeliveryMethod ─────────────────────────────────────────────────────

describe('changeDeliveryMethod', () => {
  it('updates delivery_method for a valid owned ticket', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce(ownedByUser(userId)),
      execute: vi.fn(async () => undefined),
    })

    const input: ChangeDeliveryInput = {
      ticketId: 'ticket-1',
      userId,
      newMethod: 'wallet_pass',
    }

    await expect(changeDeliveryMethod(input, { db })).resolves.toBeUndefined()
    expect(db.execute).toHaveBeenCalledOnce()
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls[0][1]).toContain('wallet_pass')
  })

  it('throws TICKET_NOT_FOUND when ticket does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    })

    const input: ChangeDeliveryInput = {
      ticketId: 'missing',
      userId: 'user-1',
      newMethod: 'email',
    }

    await expect(changeDeliveryMethod(input, { db })).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_NOT_OWNED_BY_USER for wrong user', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ user_id: 'other-user' }]),
    })

    const input: ChangeDeliveryInput = {
      ticketId: 'ticket-1',
      userId: 'user-1',
      newMethod: 'sms',
    }

    await expect(changeDeliveryMethod(input, { db })).rejects.toMatchObject({ code: 'TICKET_NOT_OWNED_BY_USER' })
  })
})

// ── getReissueHistory ────────────────────────────────────────────────────────

describe('getReissueHistory', () => {
  it('returns reissue requests ordered by requestedAt desc', async () => {
    const userId = 'user-1'
    const row1 = makeReissueRequestRow({ id: 'req-1', requested_at: new Date('2026-04-15T10:00:00Z') })
    const row2 = makeReissueRequestRow({ id: 'req-2', requested_at: new Date('2026-04-14T10:00:00Z') })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))  // ownership check
        .mockResolvedValueOnce([row1, row2]),         // history rows
    })

    const history = await getReissueHistory('ticket-1', userId, { db })

    expect(history).toHaveLength(2)
    expect(history[0]?.id).toBe('req-1')
    expect(history[1]?.id).toBe('req-2')
  })

  it('returns empty array when no reissue history exists', async () => {
    const userId = 'user-1'
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))
        .mockResolvedValueOnce([]),
    })

    const history = await getReissueHistory('ticket-1', userId, { db })

    expect(history).toHaveLength(0)
  })

  it('throws TICKET_NOT_FOUND when ticket does not exist', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([]),
    })

    await expect(
      getReissueHistory('missing', 'user-1', { db }),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' })
  })

  it('throws TICKET_NOT_OWNED_BY_USER when ticket belongs to another user', async () => {
    const db = makeDb({
      query: vi.fn().mockResolvedValueOnce([{ user_id: 'other-user' }]),
    })

    await expect(
      getReissueHistory('ticket-1', 'user-1', { db }),
    ).rejects.toMatchObject({ code: 'TICKET_NOT_OWNED_BY_USER' })
  })

  it('correctly maps DB row fields to ReissueRequest interface', async () => {
    const userId = 'user-1'
    const approvedAt = new Date('2026-04-15T11:00:00Z')
    const row = makeReissueRequestRow({
      id: 'req-99',
      status: 'approved',
      approved_by_user_id: 'admin-1',
      approved_at: approvedAt,
      notes: 'Verified at gate',
    })
    const db = makeDb({
      query: vi.fn()
        .mockResolvedValueOnce(ownedByUser(userId))
        .mockResolvedValueOnce([row]),
    })

    const history = await getReissueHistory('ticket-1', userId, { db })
    const item = history[0]

    expect(item?.id).toBe('req-99')
    expect(item?.status).toBe('approved')
    expect(item?.approvedByUserId).toBe('admin-1')
    expect(item?.approvedAt).toEqual(approvedAt)
    expect(item?.notes).toBe('Verified at gate')
  })
})

// ── ReissueError ─────────────────────────────────────────────────────────────

describe('ReissueError', () => {
  it('is an instance of Error with correct name and code', () => {
    const err = new ReissueError('TICKET_NOT_FOUND', 'not found')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ReissueError')
    expect(err.code).toBe('TICKET_NOT_FOUND')
    expect(err.message).toBe('not found')
  })
})
