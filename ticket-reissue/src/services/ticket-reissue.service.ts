import {
  ReissueInput,
  SwapInput,
  ChangeDeliveryInput,
  ReissueRequest,
  ReissueError,
  ServiceDeps,
} from '../types/ticket-reissue.types'

// ── Internal DB row shapes ───────────────────────────────────────────────────

interface TicketRow {
  user_id: string
}

interface ReissueRequestRow {
  id: string
  ticket_id: string
  order_id: string
  user_id: string
  reason: string
  status: string
  notes: string | null
  approved_by_user_id: string | null
  approved_at: Date | null
  rejected_reason: string | null
  new_ticket_id: string | null
  requested_at: Date
  processed_at: Date | null
}

function rowToReissueRequest(row: ReissueRequestRow): ReissueRequest {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    orderId: row.order_id,
    userId: row.user_id,
    reason: row.reason as ReissueRequest['reason'],
    status: row.status as ReissueRequest['status'],
    notes: row.notes,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at,
    rejectedReason: row.rejected_reason,
    newTicketId: row.new_ticket_id,
    requestedAt: row.requested_at,
    processedAt: row.processed_at,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStart(): string {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

function generateId(): string {
  // simple uuid-v4-like for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// ── Service functions ────────────────────────────────────────────────────────

export async function requestReissue(
  input: ReissueInput,
  deps: ServiceDeps,
): Promise<ReissueRequest> {
  const { db } = deps

  // Validate ticket ownership
  const ticketRows = await db.query<TicketRow>(
    'SELECT user_id FROM tickets WHERE id = $1',
    [input.ticketId],
  )
  if (ticketRows.length === 0) {
    throw new ReissueError('TICKET_NOT_FOUND', `Ticket not found: ${input.ticketId}`)
  }
  const ticket = ticketRows[0]
  if (!ticket || ticket.user_id !== input.userId) {
    throw new ReissueError('TICKET_NOT_OWNED_BY_USER', `Ticket ${input.ticketId} is not owned by user ${input.userId}`)
  }

  // Max 1 reissue per ticket per day
  const todayRequests = await db.query<ReissueRequestRow>(
    'SELECT id FROM reissue_requests WHERE ticket_id = $1 AND requested_at >= $2',
    [input.ticketId, todayStart()],
  )
  if (todayRequests.length > 0) {
    throw new ReissueError('ALREADY_REISSUED_TODAY', `A reissue has already been requested for ticket ${input.ticketId} today`)
  }

  const status = input.reason === 'scanner_failure' ? 'approved' : 'pending'
  const id = generateId()
  const now = new Date()

  await db.execute(
    `INSERT INTO reissue_requests
       (id, ticket_id, order_id, user_id, reason, status, notes, approved_by_user_id,
        approved_at, rejected_reason, new_ticket_id, requested_at, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.ticketId,
      input.orderId,
      input.userId,
      input.reason,
      status,
      input.notes ?? null,
      null,
      null,
      null,
      null,
      now,
      null,
    ],
  )

  return {
    id,
    ticketId: input.ticketId,
    orderId: input.orderId,
    userId: input.userId,
    reason: input.reason,
    status,
    notes: input.notes ?? null,
    approvedByUserId: null,
    approvedAt: null,
    rejectedReason: null,
    newTicketId: null,
    requestedAt: now,
    processedAt: null,
  }
}

export async function approveReissue(
  requestId: string,
  approverUserId: string,
  deps: ServiceDeps,
): Promise<ReissueRequest> {
  const { db } = deps

  const rows = await db.query<ReissueRequestRow>(
    'SELECT * FROM reissue_requests WHERE id = $1',
    [requestId],
  )
  if (rows.length === 0) {
    throw new ReissueError('REQUEST_NOT_FOUND', `Reissue request not found: ${requestId}`)
  }

  const now = new Date()
  await db.execute(
    `UPDATE reissue_requests
     SET status = 'approved', approved_by_user_id = $1, approved_at = $2
     WHERE id = $3`,
    [approverUserId, now, requestId],
  )

  const row = rows[0]!
  return rowToReissueRequest({
    ...row,
    status: 'approved',
    approved_by_user_id: approverUserId,
    approved_at: now,
  })
}

export async function processReissue(
  requestId: string,
  deps: ServiceDeps,
): Promise<ReissueRequest> {
  const { db } = deps

  const rows = await db.query<ReissueRequestRow>(
    'SELECT * FROM reissue_requests WHERE id = $1',
    [requestId],
  )
  if (rows.length === 0) {
    throw new ReissueError('REQUEST_NOT_FOUND', `Reissue request not found: ${requestId}`)
  }

  const request = rows[0]!

  if (request.status === 'processed') {
    throw new ReissueError('REQUEST_ALREADY_PROCESSED', `Reissue request ${requestId} has already been processed`)
  }

  if (request.status !== 'approved') {
    throw new ReissueError('REQUEST_NOT_APPROVED', `Reissue request ${requestId} is not in approved state (current: ${request.status})`)
  }

  return db.transaction(async (txDb) => {
    const newTicketId = generateId()
    const now = new Date()

    // Create new ticket (copy of the old one with new id)
    await txDb.execute(
      `INSERT INTO tickets (id, order_id, user_id, event_id, is_void, created_at)
       SELECT $1, order_id, user_id, event_id, false, now()
       FROM tickets WHERE id = $2`,
      [newTicketId, request.ticket_id],
    )

    // Void old ticket
    await txDb.execute(
      'UPDATE tickets SET is_void = true WHERE id = $1',
      [request.ticket_id],
    )

    // Update reissue request
    await txDb.execute(
      `UPDATE reissue_requests
       SET status = 'processed', new_ticket_id = $1, processed_at = $2
       WHERE id = $3`,
      [newTicketId, now, requestId],
    )

    return rowToReissueRequest({
      ...request,
      status: 'processed',
      new_ticket_id: newTicketId,
      processed_at: now,
    })
  })
}

export async function swapTickets(
  input: SwapInput,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps

  if (input.fromTicketId === input.toTicketId) {
    throw new ReissueError('SWAP_TICKETS_SAME', 'Cannot swap a ticket with itself')
  }

  // Validate both tickets are owned by the user
  const fromRows = await db.query<TicketRow>(
    'SELECT user_id FROM tickets WHERE id = $1',
    [input.fromTicketId],
  )
  if (fromRows.length === 0) {
    throw new ReissueError('TICKET_NOT_FOUND', `Ticket not found: ${input.fromTicketId}`)
  }
  const fromTicket = fromRows[0]
  if (!fromTicket || fromTicket.user_id !== input.userId) {
    throw new ReissueError('TICKET_NOT_OWNED_BY_USER', `Ticket ${input.fromTicketId} is not owned by user ${input.userId}`)
  }

  const toRows = await db.query<TicketRow>(
    'SELECT user_id FROM tickets WHERE id = $1',
    [input.toTicketId],
  )
  if (toRows.length === 0) {
    throw new ReissueError('TICKET_NOT_FOUND', `Ticket not found: ${input.toTicketId}`)
  }
  const toTicket = toRows[0]
  if (!toTicket || toTicket.user_id !== input.userId) {
    throw new ReissueError('TICKET_NOT_OWNED_BY_USER', `Ticket ${input.toTicketId} is not owned by user ${input.userId}`)
  }

  const id = generateId()
  const now = new Date()

  // Record swap
  await db.execute(
    `INSERT INTO ticket_swaps (id, from_ticket_id, to_ticket_id, user_id, reason, status, requested_at, processed_at)
     VALUES ($1, $2, $3, $4, $5, 'processed', $6, $6)`,
    [id, input.fromTicketId, input.toTicketId, input.userId, input.reason, now],
  )

  // Mark both tickets as swapped
  await db.execute(
    'UPDATE tickets SET swap_partner_id = $1 WHERE id = $2',
    [input.toTicketId, input.fromTicketId],
  )
  await db.execute(
    'UPDATE tickets SET swap_partner_id = $1 WHERE id = $2',
    [input.fromTicketId, input.toTicketId],
  )
}

export async function changeDeliveryMethod(
  input: ChangeDeliveryInput,
  deps: ServiceDeps,
): Promise<void> {
  const { db } = deps

  const rows = await db.query<TicketRow>(
    'SELECT user_id FROM tickets WHERE id = $1',
    [input.ticketId],
  )
  if (rows.length === 0) {
    throw new ReissueError('TICKET_NOT_FOUND', `Ticket not found: ${input.ticketId}`)
  }
  const ticket = rows[0]
  if (!ticket || ticket.user_id !== input.userId) {
    throw new ReissueError('TICKET_NOT_OWNED_BY_USER', `Ticket ${input.ticketId} is not owned by user ${input.userId}`)
  }

  await db.execute(
    'UPDATE tickets SET delivery_method = $1 WHERE id = $2',
    [input.newMethod, input.ticketId],
  )
}

export async function getReissueHistory(
  ticketId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<ReissueRequest[]> {
  const { db } = deps

  // Validate ownership
  const ticketRows = await db.query<TicketRow>(
    'SELECT user_id FROM tickets WHERE id = $1',
    [ticketId],
  )
  if (ticketRows.length === 0) {
    throw new ReissueError('TICKET_NOT_FOUND', `Ticket not found: ${ticketId}`)
  }
  const ticket = ticketRows[0]
  if (!ticket || ticket.user_id !== userId) {
    throw new ReissueError('TICKET_NOT_OWNED_BY_USER', `Ticket ${ticketId} is not owned by user ${userId}`)
  }

  const rows = await db.query<ReissueRequestRow>(
    'SELECT * FROM reissue_requests WHERE ticket_id = $1 ORDER BY requested_at DESC',
    [ticketId],
  )

  return rows.map(rowToReissueRequest)
}
