import {
  AllocationInput,
  AllocationStats,
  AuditEntry,
  BatchIssueInput,
  CompAllocation,
  CompCategory,
  CompStatus,
  CompTicket,
  CompTicketError,
  IssueCompInput,
  ServiceDeps,
} from '../types/comp-tickets.types'

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function createAllocation(
  input: AllocationInput,
  deps: ServiceDeps,
): Promise<CompAllocation> {
  const { db } = deps
  const id = generateId()
  const now = new Date()

  await db.execute(
    `INSERT INTO comp_allocations
       (id, event_id, organizer_id, category, total_allotted, total_issued, notes, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, 'active', $7)`,
    [id, input.eventId, input.organizerId, input.category, input.totalAllotted, input.notes ?? null, now],
  )

  const rows = await db.query<CompAllocation>(
    `SELECT id, event_id AS "eventId", organizer_id AS "organizerId", category,
            total_allotted AS "totalAllotted", total_issued AS "totalIssued",
            notes, status, created_at AS "createdAt"
     FROM comp_allocations WHERE id = $1`,
    [id],
  )

  const allocation = rows[0]
  if (!allocation) throw new CompTicketError('ALLOCATION_NOT_FOUND', `Allocation ${id} not found after insert`)
  return allocation
}

export async function issueComp(
  input: IssueCompInput,
  deps: ServiceDeps,
): Promise<CompTicket> {
  const { db } = deps

  const allocRows = await db.query<CompAllocation>(
    `SELECT id, event_id AS "eventId", organizer_id AS "organizerId", category,
            total_allotted AS "totalAllotted", total_issued AS "totalIssued",
            notes, status, created_at AS "createdAt"
     FROM comp_allocations WHERE id = $1`,
    [input.allocationId],
  )

  const allocation = allocRows[0]
  if (!allocation) {
    throw new CompTicketError('ALLOCATION_NOT_FOUND', `Allocation ${input.allocationId} not found`)
  }

  if (allocation.totalIssued >= allocation.totalAllotted) {
    throw new CompTicketError('ALLOCATION_EXHAUSTED', `Allocation ${input.allocationId} is exhausted`)
  }

  const ticketId = generateId()
  const now = new Date()

  await db.execute(
    `INSERT INTO comp_tickets
       (id, allocation_id, event_id, organizer_id, recipient_name, recipient_email,
        category, status, issued_at, redeemed_at, revoked_at, revoke_reason,
        issued_by_user_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'issued', $8, NULL, NULL, NULL, $9, $10)`,
    [
      ticketId,
      input.allocationId,
      allocation.eventId,
      allocation.organizerId,
      input.recipientName,
      input.recipientEmail,
      allocation.category,
      now,
      input.issuedByUserId,
      input.notes ?? null,
    ],
  )

  const newTotalIssued = allocation.totalIssued + 1
  const newStatus = newTotalIssued >= allocation.totalAllotted ? 'exhausted' : 'active'

  await db.execute(
    `UPDATE comp_allocations SET total_issued = $1, status = $2 WHERE id = $3`,
    [newTotalIssued, newStatus, input.allocationId],
  )

  await db.execute(
    `INSERT INTO comp_audit_log (action, comp_ticket_id, actor_user_id, details, occurred_at)
     VALUES ('issued', $1, $2, $3, $4)`,
    [ticketId, input.issuedByUserId, `Issued to ${input.recipientName} <${input.recipientEmail}>`, now],
  )

  const ticketRows = await db.query<CompTicket>(
    `SELECT id, allocation_id AS "allocationId", event_id AS "eventId",
            organizer_id AS "organizerId", recipient_name AS "recipientName",
            recipient_email AS "recipientEmail", category, status,
            issued_at AS "issuedAt", redeemed_at AS "redeemedAt",
            revoked_at AS "revokedAt", revoke_reason AS "revokeReason",
            issued_by_user_id AS "issuedByUserId", notes
     FROM comp_tickets WHERE id = $1`,
    [ticketId],
  )

  const ticket = ticketRows[0]
  if (!ticket) throw new CompTicketError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found after insert`)
  return ticket
}

export async function batchIssueComps(
  input: BatchIssueInput,
  deps: ServiceDeps,
): Promise<{ succeeded: CompTicket[]; failed: Array<{ recipient: { name: string; email: string; notes?: string }; error: CompTicketError }> }> {
  const succeeded: CompTicket[] = []
  const failed: Array<{ recipient: { name: string; email: string; notes?: string }; error: CompTicketError }> = []

  const { db } = deps

  // Verify allocation exists once
  const allocRows = await db.query<CompAllocation>(
    `SELECT id, event_id AS "eventId", organizer_id AS "organizerId", category,
            total_allotted AS "totalAllotted", total_issued AS "totalIssued",
            notes, status, created_at AS "createdAt"
     FROM comp_allocations WHERE id = $1`,
    [input.allocationId],
  )

  const allocation = allocRows[0]
  if (!allocation) {
    throw new CompTicketError('ALLOCATION_NOT_FOUND', `Allocation ${input.allocationId} not found`)
  }

  // Issue each recipient individually — partial success is expected
  for (const recipient of input.recipients) {
    try {
      const ticket = await issueComp(
        {
          allocationId: input.allocationId,
          recipientName: recipient.name,
          recipientEmail: recipient.email,
          issuedByUserId: input.issuedByUserId,
          notes: recipient.notes,
        },
        deps,
      )
      succeeded.push(ticket)
    } catch (err) {
      if (err instanceof CompTicketError) {
        failed.push({ recipient, error: err })
      } else {
        failed.push({
          recipient,
          error: new CompTicketError('ALLOCATION_EXHAUSTED', err instanceof Error ? err.message : String(err)),
        })
      }
    }
  }

  if (succeeded.length > 0 && failed.length > 0) {
    // Log batch_issued for succeeded ones
    const now = new Date()
    await db.execute(
      `INSERT INTO comp_audit_log (action, comp_ticket_id, actor_user_id, details, occurred_at)
       VALUES ('batch_issued', NULL, $1, $2, $3)`,
      [
        input.issuedByUserId,
        `Batch: ${succeeded.length} succeeded, ${failed.length} failed`,
        now,
      ],
    )
  }

  return { succeeded, failed }
}

export async function revokeComp(
  ticketId: string,
  revokeReason: string,
  actorUserId: string,
  deps: ServiceDeps,
): Promise<CompTicket> {
  const { db } = deps

  const ticketRows = await db.query<CompTicket>(
    `SELECT id, allocation_id AS "allocationId", event_id AS "eventId",
            organizer_id AS "organizerId", recipient_name AS "recipientName",
            recipient_email AS "recipientEmail", category, status,
            issued_at AS "issuedAt", redeemed_at AS "redeemedAt",
            revoked_at AS "revokedAt", revoke_reason AS "revokeReason",
            issued_by_user_id AS "issuedByUserId", notes
     FROM comp_tickets WHERE id = $1`,
    [ticketId],
  )

  const ticket = ticketRows[0]
  if (!ticket) {
    throw new CompTicketError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  }

  if (ticket.status === 'revoked') {
    throw new CompTicketError('TICKET_ALREADY_REVOKED', `Ticket ${ticketId} is already revoked`)
  }

  const now = new Date()

  await db.execute(
    `UPDATE comp_tickets SET status = 'revoked', revoked_at = $1, revoke_reason = $2 WHERE id = $3`,
    [now, revokeReason, ticketId],
  )

  // Decrement totalIssued and reactivate if exhausted
  const allocRows = await db.query<CompAllocation>(
    `SELECT id, total_issued AS "totalIssued", status FROM comp_allocations WHERE id = $1`,
    [ticket.allocationId],
  )

  const allocation = allocRows[0]
  if (allocation) {
    const newTotalIssued = Math.max(0, allocation.totalIssued - 1)
    const newStatus = allocation.status === 'exhausted' ? 'active' : allocation.status

    await db.execute(
      `UPDATE comp_allocations SET total_issued = $1, status = $2 WHERE id = $3`,
      [newTotalIssued, newStatus, ticket.allocationId],
    )
  }

  await db.execute(
    `INSERT INTO comp_audit_log (action, comp_ticket_id, actor_user_id, details, occurred_at)
     VALUES ('revoked', $1, $2, $3, $4)`,
    [ticketId, actorUserId, `Revoked: ${revokeReason}`, now],
  )

  return { ...ticket, status: 'revoked', revokedAt: now, revokeReason }
}

export async function recordAttendance(
  ticketId: string,
  deps: ServiceDeps,
): Promise<CompTicket> {
  const { db } = deps

  const ticketRows = await db.query<CompTicket>(
    `SELECT id, allocation_id AS "allocationId", event_id AS "eventId",
            organizer_id AS "organizerId", recipient_name AS "recipientName",
            recipient_email AS "recipientEmail", category, status,
            issued_at AS "issuedAt", redeemed_at AS "redeemedAt",
            revoked_at AS "revokedAt", revoke_reason AS "revokeReason",
            issued_by_user_id AS "issuedByUserId", notes
     FROM comp_tickets WHERE id = $1`,
    [ticketId],
  )

  const ticket = ticketRows[0]
  if (!ticket) {
    throw new CompTicketError('TICKET_NOT_FOUND', `Ticket ${ticketId} not found`)
  }

  if (ticket.status === 'redeemed') {
    throw new CompTicketError('TICKET_ALREADY_REDEEMED', `Ticket ${ticketId} is already redeemed`)
  }

  const now = new Date()

  await db.execute(
    `UPDATE comp_tickets SET status = 'redeemed', redeemed_at = $1 WHERE id = $2`,
    [now, ticketId],
  )

  await db.execute(
    `INSERT INTO comp_audit_log (action, comp_ticket_id, actor_user_id, details, occurred_at)
     VALUES ('redeemed', $1, $2, $3, $4)`,
    [ticketId, ticket.issuedByUserId, `Redeemed by ${ticket.recipientName}`, now],
  )

  return { ...ticket, status: 'redeemed', redeemedAt: now }
}

export async function getAllocationStats(
  allocationId: string,
  deps: ServiceDeps,
): Promise<AllocationStats> {
  const { db } = deps

  const allocRows = await db.query<CompAllocation>(
    `SELECT id, category, total_allotted AS "totalAllotted", total_issued AS "totalIssued"
     FROM comp_allocations WHERE id = $1`,
    [allocationId],
  )

  const allocation = allocRows[0]
  if (!allocation) {
    throw new CompTicketError('ALLOCATION_NOT_FOUND', `Allocation ${allocationId} not found`)
  }

  const redeemed = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM comp_tickets WHERE allocation_id = $1 AND status = 'redeemed'`,
    [allocationId],
  )

  const revoked = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM comp_tickets WHERE allocation_id = $1 AND status = 'revoked'`,
    [allocationId],
  )

  const totalRedeemed = redeemed[0]?.count ?? 0
  const totalRevoked = revoked[0]?.count ?? 0

  return {
    allocationId,
    category: allocation.category,
    totalAllotted: allocation.totalAllotted,
    totalIssued: allocation.totalIssued,
    totalRedeemed,
    totalRevoked,
    remaining: allocation.totalAllotted - allocation.totalIssued,
  }
}

export async function searchComps(
  eventId: string,
  organizerId: string,
  filters: { category?: CompCategory; status?: CompStatus; search?: string },
  deps: ServiceDeps,
): Promise<CompTicket[]> {
  const { db } = deps

  let sql = `SELECT id, allocation_id AS "allocationId", event_id AS "eventId",
             organizer_id AS "organizerId", recipient_name AS "recipientName",
             recipient_email AS "recipientEmail", category, status,
             issued_at AS "issuedAt", redeemed_at AS "redeemedAt",
             revoked_at AS "revokedAt", revoke_reason AS "revokeReason",
             issued_by_user_id AS "issuedByUserId", notes
             FROM comp_tickets
             WHERE event_id = $1 AND organizer_id = $2`

  const params: unknown[] = [eventId, organizerId]
  let idx = 3

  if (filters.category) {
    sql += ` AND category = $${idx++}`
    params.push(filters.category)
  }

  if (filters.status) {
    sql += ` AND status = $${idx++}`
    params.push(filters.status)
  }

  if (filters.search) {
    sql += ` AND (recipient_name ILIKE $${idx} OR recipient_email ILIKE $${idx})`
    params.push(`%${filters.search}%`)
    idx++
  }

  sql += ' ORDER BY issued_at DESC'

  return db.query<CompTicket>(sql, params)
}

export async function getAuditTrail(
  eventId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<AuditEntry[]> {
  const { db } = deps

  return db.query<AuditEntry>(
    `SELECT a.action, a.comp_ticket_id AS "compTicketId",
            a.actor_user_id AS "actorUserId", a.details,
            a.occurred_at AS "occurredAt"
     FROM comp_audit_log a
     LEFT JOIN comp_tickets t ON t.id = a.comp_ticket_id
     WHERE (t.event_id = $1 AND t.organizer_id = $2)
        OR (a.comp_ticket_id IS NULL)
     ORDER BY a.occurred_at DESC`,
    [eventId, organizerId],
  )
}
